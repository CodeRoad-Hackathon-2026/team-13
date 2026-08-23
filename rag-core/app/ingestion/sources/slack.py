"""Slack connector — incident channels, indexed one document per thread.

Indexing individual messages would be a mistake: a message reading "yeah that
fixed it" is meaningless alone, and retrieving it during an incident is worse
than retrieving nothing. A thread is the smallest unit that carries a whole
symptom → diagnosis → fix arc, so that is the document boundary.

Requires a bot token with `channels:history` (or `groups:history`) and
`channels:read`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import (
    CheckResult,
    Field,
    SourceRun,
    check,
    parse_dt,
    register,
)

logger = logging.getLogger(__name__)


class SlackError(RuntimeError):
    pass


async def _call(client: httpx.AsyncClient, method: str, **params) -> dict:
    response = await client.get(f"/api/{method}", params=params)
    response.raise_for_status()
    payload = response.json()
    if not payload.get("ok"):
        raise SlackError(f"slack {method} failed: {payload.get('error')}")
    return payload


async def _resolve_users(client: httpx.AsyncClient) -> dict[str, str]:
    """Map user ids to display names so threads read as a conversation."""
    names: dict[str, str] = {}
    cursor = ""
    try:
        while True:
            payload = await _call(client, "users.list", limit=200, cursor=cursor)
            for user in payload.get("members", []):
                profile = user.get("profile") or {}
                names[user["id"]] = (
                    profile.get("display_name") or profile.get("real_name") or user["id"]
                )
            cursor = (payload.get("response_metadata") or {}).get("next_cursor") or ""
            if not cursor:
                break
    except (SlackError, httpx.HTTPError):
        # users:read is an extra scope; degrade to raw ids rather than failing.
        logger.warning("slack: could not resolve user names; falling back to ids")
    return names


def _render_thread(messages: list[dict], names: dict[str, str]) -> str:
    lines: list[str] = []
    for message in messages:
        author = names.get(message.get("user", ""), message.get("user") or "unknown")
        stamp = datetime.fromtimestamp(
            float(message.get("ts", 0)), tz=timezone.utc
        ).strftime("%Y-%m-%d %H:%M")
        text = (message.get("text") or "").strip()
        for attachment in message.get("attachments") or []:
            if attachment.get("text"):
                text += "\n" + attachment["text"]
        if text:
            lines.append(f"**{author}** ({stamp}): {text}")
    return "\n\n".join(lines)


@check("slack")
async def check_slack(config: dict) -> CheckResult:
    """`auth.test` is the one Slack call that costs nothing and proves the token.

    Channel access is checked too, because a valid token that is not a member of
    the channel fails at sync time with `not_in_channel` — an error that reads
    like a permissions bug when it is really a missing `/invite`.
    """
    async with httpx.AsyncClient(
        base_url="https://slack.com",
        headers={"Authorization": f"Bearer {config['token']}"},
        timeout=15.0,
    ) as client:
        identity = await _call(client, "auth.test")
        unreachable = []
        for channel in config.get("channels") or []:
            try:
                await _call(client, "conversations.info", channel=channel)
            except SlackError as exc:
                unreachable.append(f"{channel} ({exc})")
    if unreachable:
        return CheckResult(
            False,
            f"authenticated as {identity.get('user')} but cannot read: "
            f"{', '.join(unreachable)}. Invite the bot to the channel.",
            {"team": identity.get("team"), "user": identity.get("user")},
        )
    return CheckResult(
        True,
        f"authenticated as {identity.get('user')} in {identity.get('team')}",
        {"team": identity.get("team"), "user": identity.get("user")},
    )


@register(
    "slack",
    label="Slack",
    description=(
        "Indexes resolved threads, not individual messages: a thread is the unit "
        "that holds a problem and its resolution together."
    ),
    docs="docs/sources.md#slack",
    fields=(
        Field(
            "token",
            "Bot token",
            type="secret",
            required=True,
            placeholder="${SLACK_BOT_TOKEN}",
            help=(
                "Needs channels:history, channels:read and users:read. "
                "The bot must be invited to each channel."
            ),
        ),
        Field(
            "channels",
            "Channel IDs",
            type="list",
            required=True,
            placeholder="C01ABCDEF",
            help="IDs, not names — a renamed channel keeps its ID.",
        ),
        Field(
            "lookback_days",
            "First-run lookback (days)",
            type="number",
            default=90,
            help="Only used on the first poll; after that the cursor takes over.",
        ),
        Field(
            "min_messages",
            "Minimum messages per thread",
            type="number",
            default=2,
            help="A thread nobody replied to is a question, not an answer.",
        ),
        Field("max_threads", "Max threads per poll", type="number", default=200, advanced=True),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
    ),
)
async def run_slack_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    """config:
      token       — "${SLACK_BOT_TOKEN}"
      channels[]  — channel ids (C…) to index
      lookback_days, max_threads, min_messages
      metadata{}
    """
    token = config["token"]
    channels: list[str] = config["channels"]
    min_messages = int(config.get("min_messages", 2))
    max_threads = int(config.get("max_threads", 200))

    oldest = cursor.get("oldest_ts")
    if not oldest:
        lookback = int(config.get("lookback_days", 90))
        oldest = str(
            datetime.now(timezone.utc).timestamp() - lookback * 86400
        )

    documents: list[DocumentInput] = []
    newest_seen = float(oldest)

    async with httpx.AsyncClient(
        base_url="https://slack.com",
        headers={"Authorization": f"Bearer {token}"},
        timeout=settings.request_timeout_seconds,
    ) as client:
        names = await _resolve_users(client)

        for channel in channels:
            channel_name = channel
            try:
                info = await _call(client, "conversations.info", channel=channel)
                channel_name = (info.get("channel") or {}).get("name", channel)
            except (SlackError, httpx.HTTPError):
                logger.warning("slack: conversations.info failed for %s", channel)

            page_cursor = ""
            roots: list[dict] = []
            while len(roots) < max_threads:
                payload = await _call(
                    client,
                    "conversations.history",
                    channel=channel,
                    oldest=oldest,
                    limit=200,
                    cursor=page_cursor,
                )
                roots.extend(payload.get("messages", []))
                page_cursor = (
                    (payload.get("response_metadata") or {}).get("next_cursor") or ""
                )
                if not page_cursor:
                    break

            for root in roots[:max_threads]:
                ts = root.get("ts")
                if not ts or root.get("subtype") in ("channel_join", "channel_leave"):
                    continue
                newest_seen = max(newest_seen, float(ts))

                messages = [root]
                if int(root.get("reply_count", 0)) > 0:
                    try:
                        replies = await _call(
                            client, "conversations.replies", channel=channel, ts=ts, limit=200
                        )
                        messages = replies.get("messages", messages)
                    except (SlackError, httpx.HTTPError):
                        logger.warning("slack: replies failed for %s/%s", channel, ts)

                if len(messages) < min_messages:
                    continue
                body = _render_thread(messages, names)
                if not body.strip():
                    continue

                first_line = (root.get("text") or "").strip().splitlines()
                title = (first_line[0][:120] if first_line else f"thread {ts}")

                documents.append(
                    DocumentInput(
                        collection=collection,
                        external_id=f"{channel}:{ts}",
                        content=f"# #{channel_name} — {title}\n\n{body}",
                        title=f"#{channel_name}: {title}",
                        uri=f"slack://channel?id={channel}&message={ts}",
                        source_type="slack",
                        metadata={
                            **(config.get("metadata") or {}),
                            "kind": "chat_thread",
                            "channel": channel_name,
                            "channel_id": channel,
                            "message_count": len(messages),
                        },
                        source_created_at=parse_dt(float(ts)),
                        source_updated_at=parse_dt(float(messages[-1].get("ts", ts))),
                    )
                )

    logger.info("slack: %d threads across %d channels", len(documents), len(channels))
    # Re-poll from just before the newest thread so late replies are picked up.
    return SourceRun(
        documents=documents,
        cursor={"oldest_ts": str(max(newest_seen - 86400, 0))},
    )
