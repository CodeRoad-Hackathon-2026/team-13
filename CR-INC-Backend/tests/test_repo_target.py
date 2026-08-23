"""Which repository and branch a change may touch.

Both strings reach a git command line and both come, at least partly, from a
model. Everything here is about refusing rather than guessing.
"""

import pytest

from app.agents.repo_target import (
    RepoTarget,
    TargetRefused,
    check_allowed,
    parse_repo,
    resolve_repo,
    safe_branch,
)
from app.config import settings


class TestParseRepo:
    @pytest.mark.parametrize(
        "url",
        [
            "git@github.com:acme/payments-api.git",
            "https://github.com/acme/payments-api",
            "https://github.com/acme/payments-api.git",
        ],
    )
    def test_reads_host_and_slug_from_any_url_form(self, url):
        assert parse_repo(url) == ("github.com", "acme/payments-api")

    def test_a_local_path_has_no_host(self):
        host, slug = parse_repo("file:///tmp/origin.git")
        assert host == "" and slug.endswith("origin.git")

    def test_something_that_is_not_org_slash_repo_is_refused(self):
        with pytest.raises(TargetRefused):
            parse_repo("https://github.com/acme")


class TestResolveRepo:
    def test_the_service_is_the_source_of_truth(self):
        host, slug, _ = resolve_repo("https://github.com/acme/payments-api", None)
        assert slug == "acme/payments-api"

    def test_a_disagreement_refuses_and_names_both(self):
        # A mismatch means the planner picked the wrong repo or the incident is
        # attributed to the wrong service. Silently preferring one hides which.
        with pytest.raises(TargetRefused) as exc:
            resolve_repo("https://github.com/acme/payments-api", "acme/checkout-web")
        assert "payments-api" in str(exc.value) and "checkout-web" in str(exc.value)

    def test_agreement_in_a_different_url_form_is_not_a_disagreement(self):
        _, slug, _ = resolve_repo(
            "https://github.com/acme/payments-api.git", "git@github.com:acme/payments-api"
        )
        assert slug == "acme/payments-api"

    def test_falls_back_to_the_planner_when_the_service_has_no_repository(self):
        _, slug, _ = resolve_repo(None, "https://github.com/acme/payments-api")
        assert slug == "acme/payments-api"

    def test_neither_naming_a_repository_refuses(self):
        with pytest.raises(TargetRefused):
            resolve_repo(None, None)


class TestCheckAllowed:
    def test_an_empty_allowlist_permits_nothing(self, monkeypatch):
        # Deny by default, like execution_allowed_hosts.
        monkeypatch.setattr(settings, "change_delivery_allowed_repos", [])
        with pytest.raises(TargetRefused) as exc:
            check_allowed("github.com", "acme/payments-api")
        assert "CHANGE_DELIVERY_ALLOWED_REPOS" in str(exc.value)

    def test_a_repository_outside_the_list_is_refused(self, monkeypatch):
        monkeypatch.setattr(settings, "change_delivery_allowed_repos", ["acme/other"])
        with pytest.raises(TargetRefused):
            check_allowed("github.com", "acme/payments-api")

    def test_a_listed_repository_passes(self, monkeypatch):
        monkeypatch.setattr(settings, "change_delivery_allowed_repos", ["acme/payments-api"])
        check_allowed("github.com", "acme/payments-api")

    def test_an_unlisted_host_is_refused(self, monkeypatch):
        monkeypatch.setattr(settings, "change_delivery_allowed_repos", ["acme/payments-api"])
        monkeypatch.setattr(settings, "change_delivery_allowed_hosts", ["github.com"])
        with pytest.raises(TargetRefused):
            check_allowed("evil.example", "acme/payments-api")


class TestSafeBranch:
    def test_keeps_a_sensible_name_and_forces_the_prefix(self):
        assert safe_branch("remediate/pool-1", "main", "x") == "remediate/pool-1"
        assert safe_branch("pool-1", "main", "x") == "remediate/pool-1"

    @pytest.mark.parametrize("bad", ["--force", "a..b", "has space", "x@{1}", ""])
    def test_anything_unsafe_falls_back_to_the_generated_name(self, bad):
        # A leading dash would read as a flag; `..` is a revision range.
        assert safe_branch(bad, "main", "exec123") == "remediate/exec123"

    @pytest.mark.parametrize("protected", ["main", "master", "remediate/main"])
    def test_refuses_to_deliver_onto_a_protected_branch(self, protected):
        with pytest.raises(TargetRefused):
            safe_branch(protected, "main", "x")

    def test_refuses_the_base_branch_itself(self):
        with pytest.raises(TargetRefused):
            safe_branch("release-42", "release-42", "x")


class TestCompareUrl:
    def test_built_from_the_resolved_repository(self):
        target = RepoTarget("github.com", "acme/api", "git@github.com:acme/api.git", "main", "remediate/x")
        assert target.compare_url == "https://github.com/acme/api/compare/main...remediate/x?expand=1"

    def test_none_off_github_rather_than_a_fabricated_link(self):
        target = RepoTarget("", "/tmp/origin.git", "file:///tmp/origin.git", "main", "remediate/x")
        assert target.compare_url is None
