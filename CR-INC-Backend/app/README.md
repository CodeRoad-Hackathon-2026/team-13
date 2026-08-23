# Agents — AI Incident Response Orchestrator

The layer between the incident database (`../db`) and **RAG Core**. It exists for
two reasons the frontend cannot solve on its own:

1. **The data is here, not there.** RAG Core stores documents and chunks. The
   dashboard reads incidents, recommended actions, agent runs and events — the
   tables in `../db/migrations`.
2. **The key stays server-side.** RAG Core authenticates with a static
   `X-API-Key` whose scope also covers `/v1/secrets`. Shipping it to a browser
   would hand every visitor administrative access to the RAG.

## What runs today

Five of the seven registered agents:

| Agent | Calls | Writes |
|---|---|---|
| `Incident Intake Agent` | — | `incidents` |
| `Classification Agent` | `POST /v1/answer` | category, priority, service, environment |
| `RAG Retrieval Agent` | `POST /v1/search` | `similarity_matches`, `is_known_incident` |
| `Decision Agent` | `POST /v1/answer` | `recommended_actions` (status `PROPOSED`) |
| `Knowledge Generation Agent` | `POST /v1/documents` | `knowledge_documents`, and the RAG corpus |
| `Change Delivery Agent` | `git`, and `/v1/answer` when a patch needs rewriting | a pushed branch and a compare URL |

All of them record an `agent_runs` row and emit `incident_events` using the
vocabulary the dashboard already draws icons for.

| `Execution Agent` | a registered tool | `executed_actions` (terminal status) |

`Validation` is seeded in the registry but not implemented.

## Delivering a code change

The Decision Agent writes a diff from a runbook, not from the repository — it can
reference lines that have since moved. The Change Delivery Agent clones the real code
and proves the patch applies before anything is pushed, walking a ladder of increasingly
tolerant `git apply` flags and, when none of them work, asking the model again with the
actual file in front of it.

It runs as a sub-agent of the Execution Agent rather than beside it. Two agents writing
`executed_actions` would be two paths that can leave a row RUNNING, and the second one is
the one that would be wrong. The operator still sees both in the trace.

**After a regeneration, the diff being pushed is not the diff that was approved.** That is
only acceptable because no pull request is opened programmatically: the compare URL puts
the real change in front of a person before anything can merge. `regenerations: N` is
recorded in the execution payload and in the commit body. If a token ever arrives and
someone automates PR creation, this path has to be re-reviewed first.

### Before you give it a key

`CHANGE_DELIVERY_PUSH_ENABLED` is `false` by default: it clones, applies and commits, and
stops. Turning it on means mounting a private key, and a mounted key is a write credential
for anything that can execute in this container — which already runs HTTP requests and git
operations authored by a language model.

In order of how much they buy you:

1. A **per-repository deploy key**, not a personal one. Blast radius of one repository.
2. **Branch protection on the base branch**, so a pushed branch cannot become a deploy.
3. **Do not give the key to a repository whose CI runs on push to arbitrary branches.** A
   pushed branch that triggers a workflow is remote code execution authored by a model.
   This is the sharpest edge in the feature.

`CHANGE_DELIVERY_ALLOWED_REPOS` is empty by default and nothing is delivered until a
repository is listed. `services.repository_url` is authoritative over whatever the planner
wrote, and a disagreement between the two refuses rather than picking one — a mismatch
means either the planner chose wrongly or the incident is attributed to the wrong service,
and a human needs to see which.

**The tool registry** (`app/tools/`) is what an action_type means in practice.
Nothing is registered implicitly: an action whose type has no tool fails saying
so, rather than appearing to run. HTTP is the only tool today, and it refuses any
host outside `EXECUTION_ALLOWED_HOSTS` — the endpoint comes from a language
model's output, so without that list this would be a request-forgery primitive
that a human approves by clicking Approve.

An execution left in RUNNING is not neutral: the card polls it forever and tells
the operator the remediation is still working. Every path through the Execution
Agent ends in a terminal status.

## The loop

```
POST /api/incidents/ingest
      │
      ▼
   Intake ──▶ Classification ──▶ Retrieval ──▶ Decision ──▶ approval queue
                                                                  │
                                            operator rejects ─────┘
                                                     │
                                                     ▼
                                        POST /v1/feedback (rating −1)
```

The last arrow is the part worth knowing about. A rejection is the most
informative signal this system produces — a human looked at grounded evidence
and said no — and RAG Core's hybrid ranking carries a feedback component, so
returning it makes the sources behind a bad recommendation rank lower next time.
It is best-effort: the rejection is already durable, and an operator's action
must never fail because the RAG is unreachable.

## Run

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # set RAG_API_KEY
.venv/bin/python -m pytest    # pure-logic tests, no database needed
```

```bash
uvicorn app.main:app --port 8001            # the dashboard's API
```

```python
from app.agents.pipeline import intake_and_triage, triage_incident

await intake_and_triage({"subject": "...", "body": "...", "source": "pagerduty"})
await triage_incident("<incident-uuid>")    # re-run on an existing incident
```

## Two things worth knowing before extending it

**A run always closes.** `Agent.execute` opens `agent_runs` as `RUNNING` before
the work starts and closes it in every path, including exceptions — a crashed
step ends `FAILED` with its error, never lingers as `RUNNING`. The dashboard
renders that row as the agent trace, so a stuck `RUNNING` reads as "still
working" forever.

**Failing and declining are different.** A planner that says "the sources do not
support an action", or a RAG Core abstention, is a `SUCCESS` whose output says
`proposed: false`. Only genuine faults — the RAG unreachable, a structured reply
naming no tool — are `FAILED`. Painting a normal outcome red trains operators to
ignore red.

**Intake is the one agent whose run cannot precede its own incident.**
`agent_runs.incident_id` is a NOT NULL foreign key, so there is nothing to
attribute a run to until the row exists. Intake creates the incident first and
records the run that parsed it, both in one transaction.

**A replayed alert is one incident.** Same source plus same external id returns
the existing row rather than opening a second one — webhooks retry.

## The one link that needs care

`similarity_matches.knowledge_document_id` is a real foreign key, so a RAG hit
can only be recorded if this database already knows the document. The retrieval
agent maps `external_id` from a hit onto `knowledge_documents.source_id` (or the
row's own UUID). Hits it cannot resolve are **reported, not invented** — they
come back in the run output as `unlinked_external_ids`. A growing list there
means the two corpora have drifted, which is worth seeing rather than papering
over with a fabricated source the operator could click through to.
