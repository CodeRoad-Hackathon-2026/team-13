"""Tests for the setup surface: vault crypto, connector specs, prompt validation."""

from __future__ import annotations

import pytest

from app import vault
from app.ingestion.sources import (
    SOURCE_CHECKS,
    SOURCE_SPECS,
    SOURCE_TYPES,
    MissingSecret,
    resolve_secrets,
)
from app.rag import prompt_store
from app.rag.prompt_store import PromptValidationError, validate_body


# ------------------------------------------------------------------- vault
@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(vault.settings, "secrets_key", "0" * 43)
    return vault.settings.secrets_key


def test_roundtrip(key):
    ciphertext, nonce, key_id = vault.encrypt("SLACK_TOKEN", "xoxb-abc")
    assert vault.decrypt("SLACK_TOKEN", ciphertext, nonce, key_id) == "xoxb-abc"


def test_ciphertext_does_not_contain_the_plaintext(key):
    ciphertext, _, _ = vault.encrypt("T", "xoxb-super-secret")
    assert b"xoxb" not in ciphertext


def test_ciphertext_moved_to_another_name_fails(key):
    """The name is authenticated, so a row swap cannot become a valid token."""
    ciphertext, nonce, key_id = vault.encrypt("SLACK_TOKEN", "xoxb-abc")
    with pytest.raises(vault.VaultError):
        vault.decrypt("JIRA_TOKEN", ciphertext, nonce, key_id)


def test_a_changed_key_is_reported_not_silently_wrong(key, monkeypatch):
    ciphertext, nonce, key_id = vault.encrypt("T", "value")
    monkeypatch.setattr(vault.settings, "secrets_key", "1" * 43)
    with pytest.raises(vault.VaultError, match="different SECRETS_KEY"):
        vault.decrypt("T", ciphertext, nonce, key_id)


def test_disabled_without_a_key(monkeypatch):
    monkeypatch.setattr(vault.settings, "secrets_key", None)
    assert not vault.vault_enabled()
    with pytest.raises(vault.VaultError, match="SECRETS_KEY is not set"):
        vault.encrypt("T", "v")


def test_hint_is_short_enough_to_be_useless(key):
    assert vault.hint_of("xoxb-super-secret-4f2a") == "4f2a"
    # A short secret gets no hint at all: four of eight characters is a leak.
    assert vault.hint_of("short") == ""


def test_tracking_vault_records_reads():
    tracked = vault.TrackingVault({"A": "1", "B": "2"})
    assert tracked["A"] == "1"
    assert tracked.used == {"A"}


def test_redact_masks_literal_credentials_but_keeps_references():
    config = {"token": "xoxb-literal", "api_token": "${JIRA_TOKEN}", "url": "https://x"}
    redacted = vault.redact(config)
    assert redacted["token"] == "••••••"
    assert redacted["api_token"] == "${JIRA_TOKEN}"
    assert redacted["url"] == "https://x"


# --------------------------------------------------------------- resolution
def test_vault_wins_over_environment(monkeypatch):
    monkeypatch.setenv("TOKEN", "from-env")
    assert resolve_secrets("${TOKEN}", {"TOKEN": "from-vault"}) == "from-vault"


def test_environment_still_works_without_a_vault(monkeypatch):
    monkeypatch.setenv("TOKEN", "from-env")
    assert resolve_secrets("${TOKEN}", {}) == "from-env"


def test_resolution_is_recursive():
    resolved = resolve_secrets(
        {"a": {"b": ["${T}"]}, "c": "x-${T}-y"}, {"T": "v"}
    )
    assert resolved == {"a": {"b": ["v"]}, "c": "x-v-y"}


def test_missing_secret_fails_loudly():
    with pytest.raises(MissingSecret, match="NOPE"):
        resolve_secrets("${NOPE}", {})


# ------------------------------------------------------------ connector specs
def test_every_connector_declares_a_spec():
    assert set(SOURCE_SPECS) == set(SOURCE_TYPES)


def test_specs_are_serializable_and_complete():
    for name, spec in SOURCE_SPECS.items():
        payload = spec.to_dict()
        assert payload["label"] and payload["description"], name
        assert payload["fields"], name
        for field in payload["fields"]:
            assert field["name"] and field["label"], name
            assert field["type"] in {
                "text", "secret", "number", "boolean",
                "textarea", "list", "keyvalue", "select",
            }, (name, field)


def test_select_fields_offer_options():
    for name, spec in SOURCE_SPECS.items():
        for field in spec.fields:
            if field.type == "select":
                assert field.options, f"{name}.{field.name}"


def test_credential_fields_are_typed_secret():
    """A token rendered as a plain text box invites pasting the literal value."""
    for name, spec in SOURCE_SPECS.items():
        for field in spec.fields:
            looks_secret = any(
                hint in field.name
                for hint in ("token", "secret_access_key", "api_token", "password")
            )
            if looks_secret:
                assert field.type == "secret", f"{name}.{field.name}"


def test_mcp_tool_is_not_required_so_discovery_can_run():
    """Test connection with a blank tool lists the server's tools.

    Marking it required would make run_check reject the config before the probe
    that does the listing ever runs.
    """
    tool = next(f for f in SOURCE_SPECS["mcp"].fields if f.name == "tool")
    assert not tool.required


def test_probes_exist_for_the_connectors_that_can_have_one():
    # filesystem, http_json and every vendor connector are checkable; a
    # connector without a probe still gets the generic validation.
    assert "slack" in SOURCE_CHECKS
    assert "mcp" in SOURCE_CHECKS


# ------------------------------------------------------------------ prompts
def test_template_without_context_is_rejected():
    """The failure this prevents is invisible at runtime.

    str.format() renders a template missing {context} without error; the model
    just gets no passages and answers from its own knowledge, while citation
    validation and the judge keep reporting success against a context that was
    never sent.
    """
    with pytest.raises(PromptValidationError, match="context"):
        validate_body("answer_template", "Question: {question}")


def test_unknown_placeholder_is_rejected():
    with pytest.raises(PromptValidationError, match="unknown placeholder"):
        validate_body("answer_template", "{context} {question} {invented}")


def test_literal_brace_must_be_escaped():
    """A JSON example inside a prompt raises KeyError in format() at request time."""
    with pytest.raises(PromptValidationError):
        validate_body("answer_system", 'Reply as {"ok": true}')
    validate_body("answer_system", 'Reply as {{"ok": true}}')


def test_unbalanced_braces_are_rejected():
    with pytest.raises(PromptValidationError, match="unbalanced"):
        validate_body("answer_system", "broken { brace")


def test_empty_body_is_rejected():
    with pytest.raises(PromptValidationError, match="empty"):
        validate_body("answer_system", "   ")


def test_shipped_defaults_all_validate():
    for definition in prompt_store.PROMPT_DEFS:
        validate_body(definition.key, definition.default)


def test_prompt_set_falls_back_to_code_defaults():
    """Generation must not fail because the prompt table is unreachable."""
    assert prompt_store.DEFAULT_SET.answer_system
    assert "{context}" in prompt_store.DEFAULT_SET.answer_template


# ------------------------------------------------------------- justification
def test_citations_are_deduped_by_document():
    """Several chunks of one runbook are routinely cited together.

    Listing the same file twice with two relevance numbers reads as a bug in a
    PR body, and the document is the unit a reviewer opens.
    """
    from agents.justification import _dedupe_citations

    deduped = _dedupe_citations(
        [
            {"external_id": "runbook/rollback", "score": 0.63},
            {"external_id": "runbook/rollback", "score": 0.70},
            {"external_id": "INC-2481", "score": 0.51},
        ]
    )
    assert len(deduped) == 2
    assert {c["score"] for c in deduped} == {0.70, 0.51}


def test_api_url_without_a_scheme_is_normalized():
    """`RAG_API_URL=localhost:8000/v1` is the obvious thing to type.

    httpx rejects it with `unsupported protocol 'localhost://'`, which reads
    like a library bug rather than a missing http://.
    """
    from agents.client import _normalize

    assert _normalize("localhost:8000/v1") == "http://localhost:8000/v1"
    assert _normalize("https://rag.internal/v1/") == "https://rag.internal/v1"
