import { http, HttpResponse } from "msw";
import { RECOMMENDED_ACTIONS } from "../seededDataset";
import type { PreflightCheck, PreflightData } from "../../approvals/preflight";

// Mirrors app/agents/preflight.py closely enough to exercise the panel's three states — blocked,
// dry run, will run — without a backend. Deliberately not a reimplementation of the guards: the
// real ones read server configuration this layer has no business knowing.
//
// The seeded actions carry no parameters (the fixture parameters endpoint returns a placeholder),
// so a target is synthesised per action type.
//
// The seeded queue is LAMBDA, API and SQL, and two of those have no registered executor — so the
// API one is pointed at loopback deliberately, to make the clean verdict reachable in dev. Without
// it every card reads "blocked" and the panel looks like it only has one thing to say. The
// off-allowlist and dry-run paths are covered by tests/test_preflight.py and PreflightPanel.test
// rather than here.
const REGISTERED = new Set(["API", "WEBHOOK"]);

const SYNTHETIC_TARGET: Record<string, Record<string, unknown>> = {
  API: { endpoint: "http://localhost:9000/pool/recycle", method: "POST" },
  WEBHOOK: { endpoint: "http://localhost:9000/hooks/recycle", method: "POST" },
  GITHUB_PR: { repo: "acme/payments-api" },
};

function build(actionType: string, parameters: Record<string, unknown>): PreflightData {
  const checks: PreflightCheck[] = [];

  if (actionType === "GITHUB_PR") {
    checks.push({
      key: "executor",
      label: "Executor registered",
      status: "pass",
      detail: "Change Delivery Agent",
    });
    const repo = typeof parameters.repo === "string" ? parameters.repo : null;
    checks.push(
      repo
        ? { key: "target", label: "Repository resolved", status: "pass", detail: repo }
        : {
            key: "target",
            label: "Repository resolved",
            status: "fail",
            detail: "neither the service nor the action names a repository",
          },
    );
    if (repo) {
      checks.push({
        key: "allowlist",
        label: "Repository allowed",
        status: "fail",
        detail: `no repository is allowed for delivery; add one to CHANGE_DELIVERY_ALLOWED_REPOS before this action can run`,
      });
      checks.push({
        key: "push",
        label: "Push enabled",
        status: "pass",
        detail:
          "dry run — the change is cloned, applied and committed, then stopped before push",
      });
    }
  } else if (REGISTERED.has(actionType)) {
    checks.push({
      key: "executor",
      label: "Executor registered",
      status: "pass",
      detail: "http tool",
    });
    const endpoint =
      typeof parameters.endpoint === "string"
        ? parameters.endpoint
        : typeof parameters.url === "string"
          ? parameters.url
          : "";
    if (!endpoint) {
      checks.push({
        key: "target",
        label: "Endpoint present",
        status: "fail",
        detail: "the action carries no endpoint to call",
      });
    } else {
      checks.push({ key: "target", label: "Endpoint present", status: "pass", detail: endpoint });
      const host = (() => {
        try {
          return new URL(endpoint).hostname;
        } catch {
          return "";
        }
      })();
      const allowed = host === "localhost" || host === "127.0.0.1";
      checks.push({
        key: "allowlist",
        label: "Host allowed",
        status: allowed ? "pass" : "fail",
        detail: allowed
          ? host
          : `${host || "the endpoint"} is not in EXECUTION_ALLOWED_HOSTS — the call would be refused, not attempted`,
      });
      checks.push({
        key: "method",
        label: "Method supported",
        status: "pass",
        detail: typeof parameters.method === "string" ? parameters.method.toUpperCase() : "POST",
      });
    }
  } else {
    checks.push({
      key: "executor",
      label: "Executor registered",
      status: "fail",
      detail: `no executor is registered for ${actionType} — approving this would fail immediately without attempting anything`,
    });
  }

  const blocked = checks.filter((c) => c.status === "fail").length;
  const dryRun =
    actionType === "GITHUB_PR" && checks.some((c) => c.key === "push" && c.status === "pass");

  if (blocked > 0) {
    return {
      verdict: "blocked",
      summary: `${blocked} check${blocked > 1 ? "s" : ""} would stop this before anything happened.`,
      checks,
    };
  }
  if (dryRun) {
    return {
      verdict: "dry_run",
      summary: "This would run as a dry run — committed locally, nothing pushed.",
      checks,
    };
  }
  return { verdict: "will_run", summary: "This would run.", checks };
}

export const approvalsPreflightHandlers = [
  http.get("/api/actions/:id/preflight", ({ params }) => {
    const action = RECOMMENDED_ACTIONS.find((a) => a.id === params.id);
    if (!action) return new HttpResponse("Action not found", { status: 404 });
    return HttpResponse.json(build(action.actionType, SYNTHETIC_TARGET[action.actionType] ?? {}));
  }),
];
