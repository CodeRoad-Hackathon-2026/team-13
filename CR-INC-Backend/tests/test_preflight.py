"""What the operator is told before they press Approve.

The point of these is that pre-flight and execution cannot disagree. Every
assertion here is about reporting the guard the executor will actually apply —
so the failure mode being tested is not "wrong answer" but "reassuring answer,
followed by a refusal".
"""

import pytest

from app.agents.preflight import preflight
from app.config import settings


# Several of these turn a global guard on or off. Restoring it matters: settings is a module-level
# singleton, so a test that tightens an allowlist and walks away decides the outcome of whatever
# runs next — and the failure surfaces in the other file, which is where nobody looks.
GUARDED = (
    "execution_allowed_hosts",
    "change_delivery_allowed_repos",
    "change_delivery_allowed_hosts",
    "change_delivery_push_enabled",
    "change_delivery_ssh_key_path",
)


@pytest.fixture(autouse=True)
def restore_settings():
    saved = {name: getattr(settings, name) for name in GUARDED}
    yield
    for name, value in saved.items():
        setattr(settings, name, value)


def run(action_type, parameters=None, status="PROPOSED", approved_by=None, repository_url=None):
    return preflight(
        action_type=action_type,
        parameters=parameters or {},
        status=status,
        approved_by=approved_by,
        repository_url=repository_url,
    )


def check(result, key):
    return next((c for c in result["checks"] if c["key"] == key), None)


class TestExecutorRegistered:
    def test_a_type_with_no_executor_is_the_first_thing_reported(self):
        result = run("KUBERNETES", {"manifest": "..."})

        assert result["verdict"] == "blocked"
        assert check(result, "executor")["status"] == "fail"

    def test_and_nothing_further_is_checked_because_nothing_would_run(self):
        # Reporting a valid endpoint under "no executor" would read as three
        # quarters ready, when the answer is that approving does nothing at all.
        result = run("SQL", {"endpoint": "http://localhost:9000/x"})

        assert check(result, "target") is None
        assert check(result, "allowlist") is None

    def test_the_delivery_agent_counts_as_an_executor_though_it_is_not_a_tool(self):
        result = run("GITHUB_PR", {"repo": "acme/payments-api"})

        assert check(result, "executor")["status"] == "pass"

    @pytest.mark.parametrize("action_type", ["API", "WEBHOOK"])
    def test_the_registered_http_types_pass(self, action_type):
        result = run(action_type, {"endpoint": "http://localhost:9000/x"})

        assert check(result, "executor")["status"] == "pass"


class TestHttpGuards:
    def test_a_host_off_the_allowlist_is_reported_as_blocking(self):
        result = run("API", {"endpoint": "https://api.acme.com/recycle"})

        assert result["verdict"] == "blocked"
        assert check(result, "allowlist")["status"] == "fail"

    def test_a_host_on_it_runs(self):
        result = run("API", {"endpoint": "http://localhost:9000/recycle"})

        assert result["verdict"] == "will_run"
        assert all(c["status"] != "fail" for c in result["checks"])

    def test_the_allowlist_itself_never_reaches_the_response(self):
        # It is server configuration. The browser needs the verdict for this one
        # host, not the set of every host the orchestrator may call.
        settings.execution_allowed_hosts = ["localhost", "127.0.0.1", "internal.acme.test"]
        result = run("API", {"endpoint": "https://api.acme.com/recycle"})

        rendered = str(result)
        assert "internal.acme.test" not in rendered

    def test_a_missing_endpoint_is_a_finding_not_a_crash(self):
        result = run("API", {})

        assert check(result, "target")["status"] == "fail"

    def test_an_unsupported_method_is_reported(self):
        result = run("API", {"endpoint": "http://localhost:9000/x", "method": "TRACE"})

        assert check(result, "method")["status"] == "fail"

    def test_the_default_method_is_the_one_the_tool_would_use(self):
        result = run("API", {"endpoint": "http://localhost:9000/x"})

        assert check(result, "method")["detail"] == "POST"


class TestDeliveryGuards:
    def test_a_repository_the_service_and_the_planner_disagree_on_is_refused(self):
        result = run(
            "GITHUB_PR",
            {"repo": "acme/other"},
            repository_url="https://github.com/acme/payments-api",
        )

        assert check(result, "target")["status"] == "fail"

    def test_an_empty_allowlist_blocks_delivery(self):
        settings.change_delivery_allowed_repos = []
        result = run(
            "GITHUB_PR", {"repo": "acme/payments-api"},
            repository_url="https://github.com/acme/payments-api",
        )

        assert check(result, "allowlist")["status"] == "fail"

    def test_dry_run_is_a_pass_and_says_so_in_the_verdict(self):
        settings.change_delivery_allowed_repos = ["acme/payments-api"]
        settings.change_delivery_push_enabled = False
        result = run(
            "GITHUB_PR", {"repo": "acme/payments-api"},
            repository_url="https://github.com/acme/payments-api",
        )

        assert result["verdict"] == "dry_run"
        assert check(result, "push")["status"] == "pass"

    def test_a_real_push_is_a_warning_because_approve_means_something_else_then(self):
        settings.change_delivery_allowed_repos = ["acme/payments-api"]
        settings.change_delivery_push_enabled = True
        settings.change_delivery_ssh_key_path = __file__  # any readable file
        result = run(
            "GITHUB_PR", {"repo": "acme/payments-api"},
            repository_url="https://github.com/acme/payments-api",
        )

        assert result["verdict"] == "will_run"
        assert check(result, "push")["status"] == "warn"

    def test_push_enabled_without_a_deploy_key_blocks(self):
        settings.change_delivery_allowed_repos = ["acme/payments-api"]
        settings.change_delivery_push_enabled = True
        settings.change_delivery_ssh_key_path = "/nope/not/a/key"
        result = run(
            "GITHUB_PR", {"repo": "acme/payments-api"},
            repository_url="https://github.com/acme/payments-api",
        )

        assert check(result, "credential")["status"] == "fail"

    def test_a_missing_key_in_dry_run_is_not_reported_at_all(self):
        # It cannot matter, and reporting it would train the operator to ignore
        # this panel.
        settings.change_delivery_allowed_repos = ["acme/payments-api"]
        settings.change_delivery_push_enabled = False
        settings.change_delivery_ssh_key_path = "/nope/not/a/key"
        result = run(
            "GITHUB_PR", {"repo": "acme/payments-api"},
            repository_url="https://github.com/acme/payments-api",
        )

        assert check(result, "credential") is None


class TestActionState:
    def test_a_proposed_action_says_nothing_about_its_state(self):
        # Awaiting a decision is the whole reason the card is on screen.
        result = run("API", {"endpoint": "http://localhost:9000/x"})

        assert check(result, "state") is None

    def test_an_already_executed_action_blocks(self):
        result = run("API", {"endpoint": "http://localhost:9000/x"}, status="EXECUTED")

        assert result["verdict"] == "blocked"
        assert check(result, "state")["status"] == "fail"

    def test_an_already_approved_action_names_who_approved_it(self):
        result = run(
            "API", {"endpoint": "http://localhost:9000/x"},
            status="APPROVED", approved_by="paul",
        )

        assert check(result, "state")["status"] == "warn"
        assert "paul" in check(result, "state")["detail"]
