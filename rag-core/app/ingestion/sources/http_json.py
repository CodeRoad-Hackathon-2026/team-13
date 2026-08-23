"""Generic JSON endpoint connector.

The escape hatch: any system that can expose a JSON list — an internal API, a
BI export, a vendor without a dedicated connector — can be indexed by mapping
its fields with dotted paths, no code required.
"""

from __future__ import annotations

import httpx

from app.config import settings
from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import (
    CheckResult,
    Field,
    SourceRun,
    check,
    parse_dt,
    pluck,
    register,
)


@check("http_json")
async def check_http_json(config: dict) -> CheckResult:
    """Fetch once and report what the mapping actually resolved to.

    The common failure here is not auth — it is `items_path` or `id_field`
    pointing at nothing, which yields a source that runs green and indexes zero
    documents. Reporting the resolved id turns that into a visible error.
    """
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.request(
            config.get("method", "GET"),
            config["url"],
            headers=config.get("headers") or {},
            params=dict(config.get("params") or {}),
            json=config.get("body"),
        )
        if response.status_code >= 400:
            return CheckResult(False, f"HTTP {response.status_code}: {response.text[:300]}")
        payload = response.json()

    records = pluck(payload, config.get("items_path"), payload)
    if not isinstance(records, list):
        return CheckResult(
            False,
            f"items_path '{config.get('items_path') or '(root)'}' resolved to "
            f"{type(records).__name__}, not a list",
        )
    if not records:
        return CheckResult(True, "endpoint reachable, but it returned 0 records")

    sample_id = pluck(records[0], config["id_field"])
    if sample_id is None:
        return CheckResult(
            False,
            f"{len(records)} records returned, but id_field "
            f"'{config['id_field']}' is absent from the first one",
        )
    return CheckResult(
        True,
        f"{len(records)} records; first id resolves to '{sample_id}'",
        {"count": len(records), "sample_id": str(sample_id)},
    )


@register(
    "http_json",
    label="HTTP JSON",
    description=(
        "Generic connector for any JSON endpoint. Covers PagerDuty, ServiceNow, "
        "Datadog and internal APIs without a per-vendor connector."
    ),
    docs="docs/sources.md#http_json",
    fields=(
        Field("url", "URL", required=True, placeholder="https://api.internal/incidents"),
        Field("method", "Method", type="select", default="GET", options=("GET", "POST")),
        Field(
            "headers",
            "Headers",
            type="keyvalue",
            placeholder="Authorization = Bearer ${PAGERDUTY_TOKEN}",
            help="Secret references are expanded here too.",
        ),
        Field("params", "Query parameters", type="keyvalue", advanced=True),
        Field(
            "items_path",
            "Items path",
            placeholder="data.items",
            help="Dotted path to the array of records. Leave blank if the body is the array.",
        ),
        Field(
            "id_field",
            "ID field",
            required=True,
            placeholder="id",
            help="Dotted path to a stable identifier. Re-ingesting the same id updates in place.",
        ),
        Field(
            "content_fields",
            "Content fields",
            type="list",
            default=["content"],
            help="Dotted paths concatenated into the document body.",
        ),
        Field("title_field", "Title field", advanced=True),
        Field("uri_field", "URI field", advanced=True),
        Field(
            "updated_field",
            "Updated field",
            advanced=True,
            help="Drives the incremental watermark. Without it every poll refetches everything.",
        ),
        Field(
            "cursor_param",
            "Cursor query parameter",
            advanced=True,
            help="Query param that carries the watermark back to the API on the next poll.",
        ),
        Field("metadata_fields", "Metadata from fields", type="keyvalue", advanced=True),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
    ),
)
async def run_http_json_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    """config:
      url, method, headers{}, params{}, body
      items_path       — dotted path to the array of records (default: root)
      id_field         — dotted path to the stable id (required)
      content_fields[] — dotted paths concatenated into the body
      title_field, uri_field, updated_field
      metadata_fields  — {output_key: dotted_path}
      cursor_param     — query param carrying the incremental watermark
    """
    url = config["url"]
    id_field = config["id_field"]
    content_fields = config.get("content_fields") or ["content"]

    params = dict(config.get("params") or {})
    cursor_param = config.get("cursor_param")
    if cursor_param and cursor.get("watermark"):
        params[cursor_param] = cursor["watermark"]

    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        response = await client.request(
            config.get("method", "GET"),
            url,
            headers=config.get("headers") or {},
            params=params,
            json=config.get("body"),
        )
        response.raise_for_status()
        payload = response.json()

    records = pluck(payload, config.get("items_path"), payload)
    if isinstance(records, dict):
        records = [records]
    if not isinstance(records, list):
        raise ValueError("http_json source did not resolve to a list of records")

    updated_field = config.get("updated_field")
    watermark = cursor.get("watermark")
    documents: list[DocumentInput] = []

    for record in records:
        external_id = pluck(record, id_field)
        if external_id is None:
            continue
        parts = [
            str(pluck(record, field))
            for field in content_fields
            if pluck(record, field) is not None
        ]
        content = "\n\n".join(parts).strip()
        if not content:
            continue

        updated_raw = pluck(record, updated_field) if updated_field else None
        if updated_raw and (watermark is None or str(updated_raw) > str(watermark)):
            watermark = str(updated_raw)

        documents.append(
            DocumentInput(
                collection=collection,
                external_id=str(external_id),
                content=content,
                title=pluck(record, config.get("title_field")),
                uri=pluck(record, config.get("uri_field")),
                source_type=config.get("source_type", "http_json"),
                metadata={
                    **(config.get("metadata") or {}),
                    **{
                        key: pluck(record, path)
                        for key, path in (config.get("metadata_fields") or {}).items()
                        if pluck(record, path) is not None
                    },
                },
                source_updated_at=parse_dt(updated_raw),
            )
        )

    return SourceRun(
        documents=documents,
        cursor={"watermark": watermark} if watermark else cursor,
    )
