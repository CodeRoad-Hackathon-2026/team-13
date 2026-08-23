# Team 13 — AI Incident Response Orchestrator

Three services that together take an incident from an inbound alert to a reviewed remediation,
with the evidence attached at every step.

The idea the whole thing is built on, and the fair way to judge it: **agents propose, a person
decides, and everything is traceable.** Nothing is asserted that the system cannot show you the
basis for — where a number came from, which rule produced an outcome, and what would happen if you
pressed the button. Where something does not work yet, it says so on screen instead of looking like
it works.

## The three folders

| Folder | What it is | Stack |
|---|---|---|
| **[`Incident-tracker-ui`](Incident-tracker-ui/)** | The dashboard an on-call engineer uses. Four tabs, an approval queue, and the agent configuration. | React 19, TypeScript, Vite, TanStack Query, Recharts, Tailwind 4 |
| **[`CR-INC-Backend`](CR-INC-Backend/)** | The orchestrator. Runs the agents over an incident, owns the approval lifecycle, and enforces the policy that decides what may run unattended. | FastAPI, asyncpg, PostgreSQL |
| **[`rag-core`](rag-core/)** | Retrieval. Hybrid search over runbooks and postmortems, and the only service that talks to a language model. | FastAPI, pgvector, arq, Redis |

Each folder has its own README with the detail. **[`Incident-tracker-ui/README.md`](Incident-tracker-ui/README.md)**
has screenshots of every screen and is the best place to start.

## How they fit together

```
        browser
           │  one origin: nginx serves the SPA and proxies /api
           ▼
    Incident-tracker-ui  ──────►  CR-INC-Backend  ──────►  rag-core  ──────►  model provider
       (nginx + SPA)                (orchestrator)          (retrieval)
                                          │
                                          ▼
                                     PostgreSQL
```

Three properties of that shape are deliberate, and each one is a decision the code enforces rather
than a diagram's promise:

**The browser never sees the RAG's key.** Only the orchestrator holds it, because that key's scope
covers `/v1/secrets` — where connector credentials live. It is why the dashboard's Connections panel
is read-only: proxying a source's credentials through an endpoint the browser can reach would make
the orchestrator a confused deputy over a service it is supposed to protect.

**The orchestrator carries no LLM SDK at all.** Its agents generate through the RAG's `/v1/answer`,
so retrieval is not something an agent can skip. If the corpus has nothing to say, the pipeline
stops before proposing a remediation rather than inventing one.

**RAG Core abstains rather than guessing.** Below a measured confidence threshold it declines and
says why. The threshold is derived from an evaluation run, not chosen — see that folder's README.

## Running it

Everything comes up from one compose file, in `CR-INC-Backend`, which builds all three. It expects
the other two as sibling directories, which is exactly this layout — verified against these folder
names, not assumed:

```bash
cd CR-INC-Backend
cp .env.example .env          # set ANTHROPIC_API_KEY or OPENAI_API_KEY, and VOYAGE_API_KEY
docker compose up -d --build  # first build takes a few minutes

# The RAG corpus starts EMPTY. Without this the agents correctly abstain from
# everything, and the dashboard has nothing to show.
docker compose run --rm orchestrator python -m app.corpus

open http://localhost:8900
```

To work on the dashboard alone, with no backend at all:

```bash
cd Incident-tracker-ui && npm install && npm run dev
```

Every request is intercepted in the browser by MSW against a seeded fixture dataset, so the whole
app is interactive with zero setup — including creating an agent skill and stepping through an
approval.

## Where the interesting decisions are

If you only read a few things:

- **[`DEMO-VIDEO.md`](DEMO-VIDEO.md)** — a three-minute walkthrough, verified by running the whole
  stack rather than written from the spec: every number in it came out of the app. It ends with a
  table of what was measured and then a list of what is **not** presentable and why, which is the
  most honest thing in this repository.

- **[`Incident-tracker-ui/README.md`](Incident-tracker-ui/README.md)** — the screens, and for each
  one why it is drawn the way it is. The parts worth reading explain a defect that was fixed rather
  than a feature that was added: why the funnel's bars encode share of received rather than
  conversion rate, and why two colours in the outcome donut had to be replaced after being measured
  at ΔE 0.4 under deuteranopia — the same colour, for a colourblind reader.
- **`CR-INC-Backend/app/agents/policy.py`** — the single point that decides whether a human sees an
  agent's proposal. Every guard it applies is reported to the operator with the sentence that
  justifies it.
- **`CR-INC-Backend/app/agents/preflight.py`** — what would happen if you approved this, answered
  *before* the approval by calling the same guards the executor calls. On the seeded data it
  immediately reveals that the highest-confidence proposal in the queue has no executor registered
  and would do nothing at all.
- **`CR-INC-Backend/db/seeds/004_code_change_runbooks.sql`** — three runbooks written so the
  planner returns a *grounded* diff instead of an invented one: they carry the repository as
  `org/repo`, the file with real line numbers, and the old and new values side by side. Without
  that shape the agent has to guess a filename, and the patch comes out add-only.

## Repository history

These three were separate repositories, referenced here as git submodules. Submodules make a
submission hard to read — a clone needs `--recursive` plus access to each private repo — so they are
now plain folders, exported from each project's tracked files. The upstream repositories keep their
own commit history; this repo holds the code as it stood at submission.
