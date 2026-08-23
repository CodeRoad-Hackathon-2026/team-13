# AI Incident Response Orchestrator — Database Schema

## 1. Overview

This schema is designed for a PostgreSQL database supporting the AI Incident Response Orchestrator.

The model separates four main concerns:

1. **Incident management** — what happened and its current state.
2. **AI orchestration** — which agents analyzed the incident and what they decided.
3. **Automation** — actions recommended, approved, executed, and validated.
4. **Knowledge/RAG** — historical incidents, runbooks, postmortems, and other knowledge used for semantic retrieval.

The design combines the recommended **AI-native incident model** with an **event timeline** for traceability.

---

## 2. High-Level Entity Relationship

```text
services
   │
   └──────────────┐
                  ▼
              incidents
                  │
        ┌─────────┼──────────┬──────────────┐
        ▼         ▼          ▼              ▼
incident_events  agent_runs  recommended_actions
        │         │          │
        │         │          ▼
        │         │    executed_actions
        │
        ▼
knowledge / RAG

incidents
   │
   └──── similarity_matches ────> knowledge_documents
                                      │
                                      ▼
                              knowledge_embeddings

agents
   │
   └──── agent_runs

incidents
   │
   └──── developer_feedback
```

---

# 3. Core Tables

## 3.1 `services`

Represents an application, microservice, or system supported by the engineering organization.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Service name |
| `description` | TEXT | Optional description |
| `owner` | VARCHAR | Team or owner |
| `repository_url` | TEXT | GitHub repository |
| `environment` | VARCHAR | Optional default environment |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update |

---

## 3.2 `incidents`

The central operational entity.

An incident may originate from email, monitoring, Slack, API, or manual creation.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `external_id` | VARCHAR | ID from source system |
| `title` | VARCHAR | Incident title |
| `description` | TEXT | Original incident description |
| `status` | VARCHAR | `OPEN`, `INVESTIGATING`, `MITIGATED`, `RESOLVED`, `CLOSED`, `ESCALATED` |
| `priority` | VARCHAR | `P1`, `P2`, `P3`, `P4` |
| `category` | VARCHAR | Database, API, Infrastructure, Deployment, etc. |
| `source` | VARCHAR | Email, Slack, PagerDuty, API, Manual |
| `service_id` | UUID | FK → `services.id` |
| `environment` | VARCHAR | Production, Staging, Development |
| `assigned_to` | VARCHAR | Developer/team |
| `is_known_incident` | BOOLEAN | Whether similar historical incident was found |
| `confidence_score` | DECIMAL | AI confidence from 0 to 1 |
| `created_at` | TIMESTAMP | Incident creation |
| `updated_at` | TIMESTAMP | Last update |
| `resolved_at` | TIMESTAMP | Resolution timestamp |
| `resolution_summary` | TEXT | Final resolution |

### Important indexes

```sql
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_priority ON incidents(priority);
CREATE INDEX idx_incidents_service ON incidents(service_id);
CREATE INDEX idx_incidents_created_at ON incidents(created_at);
CREATE INDEX idx_incidents_category ON incidents(category);
```

---

# 4. Incident Timeline

## 4.1 `incident_events`

Stores everything that happens during an incident.

This table provides the audit timeline for the dashboard.

Examples:

- Incident received
- Email parsed
- Classification completed
- RAG search completed
- Similar incident found
- Developer notified
- Lambda executed
- Validation completed
- Incident resolved

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `incident_id` | UUID | FK → `incidents.id` |
| `event_type` | VARCHAR | Event type |
| `description` | TEXT | Human-readable description |
| `payload` | JSONB | Structured event data |
| `created_at` | TIMESTAMP | Event timestamp |
| `created_by` | VARCHAR | Agent, user, system |

Recommended event types:

```text
INCIDENT_CREATED
EMAIL_RECEIVED
INCIDENT_CLASSIFIED
RAG_SEARCH_STARTED
RAG_SEARCH_COMPLETED
SIMILAR_INCIDENT_FOUND
ACTION_RECOMMENDED
ACTION_APPROVED
ACTION_REJECTED
ACTION_EXECUTED
VALIDATION_STARTED
VALIDATION_PASSED
VALIDATION_FAILED
DEVELOPER_NOTIFIED
ESCALATED
RESOLVED
CLOSED
```

---

# 5. AI Agent Tables

## 5.1 `agents`

Registry of AI agents participating in the workflow.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Agent name |
| `description` | TEXT | Agent responsibility |
| `version` | VARCHAR | Agent/prompt version |
| `is_active` | BOOLEAN | Whether agent is active |
| `created_at` | TIMESTAMP | Creation timestamp |

Example agents:

```text
Incident Intake Agent
Classification Agent
RAG Retrieval Agent
Decision Agent
Execution Agent
Validation Agent
Knowledge Generation Agent
```

---

## 5.2 `agent_runs`

Stores every execution of an AI agent.

This is important for debugging, auditing, and measuring AI performance.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `incident_id` | UUID | FK → `incidents.id` |
| `agent_id` | UUID | FK → `agents.id` |
| `status` | VARCHAR | RUNNING, SUCCESS, FAILED |
| `input` | JSONB | Agent input |
| `output` | JSONB | Agent output |
| `confidence_score` | DECIMAL | AI confidence |
| `started_at` | TIMESTAMP | Start |
| `finished_at` | TIMESTAMP | End |
| `error_message` | TEXT | Error if failed |

Optional metrics:

```text
tokens_input
tokens_output
latency_ms
model
prompt_version
```

---

# 6. Automation

## 6.1 `recommended_actions`

Actions proposed by the AI.

The recommendation should be separate from execution.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `incident_id` | UUID | FK → `incidents.id` |
| `agent_run_id` | UUID | FK → `agent_runs.id` |
| `action_type` | VARCHAR | SQL, LAMBDA, API, GITHUB_PR, KUBERNETES, etc. |
| `description` | TEXT | Human-readable action |
| `parameters` | JSONB | Action parameters |
| `risk_level` | VARCHAR | LOW, MEDIUM, HIGH |
| `confidence_score` | DECIMAL | AI confidence |
| `approval_required` | BOOLEAN | Human approval required |
| `approved_by` | VARCHAR | Approver |
| `approved_at` | TIMESTAMP | Approval timestamp |
| `status` | VARCHAR | PROPOSED, APPROVED, REJECTED, EXECUTED |

---

## 6.2 `executed_actions`

Records actual execution.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `recommended_action_id` | UUID | FK → `recommended_actions.id` |
| `started_at` | TIMESTAMP | Start |
| `finished_at` | TIMESTAMP | End |
| `status` | VARCHAR | RUNNING, SUCCESS, FAILED, ROLLED_BACK |
| `request_payload` | JSONB | Actual request |
| `response_payload` | JSONB | Tool response |
| `execution_logs` | TEXT | Logs |
| `error_message` | TEXT | Error |

---

# 7. RAG Knowledge Base

## 7.1 `knowledge_documents`

Represents documents used by the RAG system.

Possible document types:

```text
INCIDENT
RUNBOOK
POSTMORTEM
GITHUB_ISSUE
GITHUB_PR
DOCUMENTATION
EMAIL
TROUBLESHOOTING_GUIDE
```

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `title` | VARCHAR | Document title |
| `summary` | TEXT | Short summary |
| `content` | TEXT | Full document |
| `document_type` | VARCHAR | Document category |
| `source` | VARCHAR | Source system |
| `source_url` | TEXT | Original location |
| `source_id` | VARCHAR | External identifier |
| `incident_id` | UUID | Optional FK → `incidents.id` |
| `created_at` | TIMESTAMP | Creation |
| `updated_at` | TIMESTAMP | Last update |

---

## 7.2 `knowledge_embeddings`

Stores chunks and vector embeddings for semantic search.

Recommended implementation: PostgreSQL + `pgvector`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `knowledge_document_id` | UUID | FK → `knowledge_documents.id` |
| `chunk_index` | INTEGER | Chunk order |
| `content` | TEXT | Chunk text |
| `embedding` | VECTOR | Embedding vector |
| `created_at` | TIMESTAMP | Creation |

Example:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

embedding VECTOR(1536);
```

The exact vector dimension should match the embedding model selected for the project.

Recommended index:

```sql
CREATE INDEX idx_knowledge_embeddings_vector
ON knowledge_embeddings
USING hnsw (embedding vector_cosine_ops);
```

---

# 8. Similar Incident Matching

## 8.1 `similarity_matches`

Stores the relationship between an incident and knowledge retrieved by the RAG system.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `incident_id` | UUID | FK → `incidents.id` |
| `knowledge_document_id` | UUID | FK → `knowledge_documents.id` |
| `similarity_score` | DECIMAL | Similarity 0–1 |
| `match_type` | VARCHAR | SEMANTIC, EXACT, CATEGORY |
| `created_at` | TIMESTAMP | Match timestamp |

Example:

```text
Incident #1001
       │
       ├── Incident #842 → 0.97
       ├── Incident #721 → 0.89
       └── Runbook #42   → 0.84
```

---

# 9. Human Feedback

## 9.1 `developer_feedback`

Stores human decisions and feedback on AI analysis.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `incident_id` | UUID | FK → `incidents.id` |
| `agent_run_id` | UUID | Optional FK |
| `feedback_type` | VARCHAR | APPROVED, REJECTED, CORRECTED |
| `comments` | TEXT | Developer feedback |
| `corrected_category` | VARCHAR | Optional |
| `corrected_priority` | VARCHAR | Optional |
| `corrected_resolution` | TEXT | Optional |
| `created_by` | VARCHAR | Developer |
| `created_at` | TIMESTAMP | Timestamp |

This table is important for the future learning/evaluation loop.

---

# 10. Dashboard Queries

The schema should support the following dashboard metrics.

## Open incidents

```sql
SELECT COUNT(*)
FROM incidents
WHERE status NOT IN ('RESOLVED', 'CLOSED');
```

## Incidents by priority

```sql
SELECT priority, COUNT(*)
FROM incidents
GROUP BY priority
ORDER BY priority;
```

## Incidents by category

```sql
SELECT category, COUNT(*)
FROM incidents
GROUP BY category
ORDER BY COUNT(*) DESC;
```

## Known vs unknown incidents

```sql
SELECT is_known_incident, COUNT(*)
FROM incidents
GROUP BY is_known_incident;
```

## Average resolution time

```sql
SELECT
    AVG(resolved_at - created_at) AS average_resolution_time
FROM incidents
WHERE resolved_at IS NOT NULL;
```

## Automation success rate

```sql
SELECT
    COUNT(*) FILTER (WHERE status = 'SUCCESS') * 100.0
    / NULLIF(COUNT(*), 0) AS success_rate
FROM executed_actions;
```

---

# 11. Recommended PostgreSQL Extensions

For the hackathon:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
```

Optional depending on implementation:

```text
pg_trgm
```

`pg_trgm` can be useful for traditional text similarity in addition to vector similarity.

---

# 12. Suggested Status Enums

For a first implementation, PostgreSQL enums can make the model safer.

### Incident status

```text
OPEN
INVESTIGATING
MITIGATED
RESOLVED
CLOSED
ESCALATED
```

### Priority

```text
P1
P2
P3
P4
```

### Agent execution

```text
RUNNING
SUCCESS
FAILED
```

### Action status

```text
PROPOSED
APPROVED
REJECTED
EXECUTED
```

---

# 13. MVP Scope

For the hackathon, do not implement every possible table immediately.

Start with:

```text
services
incidents
incident_events

agents
agent_runs

recommended_actions
executed_actions

knowledge_documents
knowledge_embeddings
similarity_matches

developer_feedback
```

This is enough to demonstrate the complete lifecycle:

```text
Email
  │
  ▼
Incident
  │
  ▼
Intake Agent
  │
  ▼
Classification
  │
  ▼
RAG Search
  │
  ├── Known Incident
  │       │
  │       ▼
  │   Recommended Action
  │       │
  │       ▼
  │   Human Approval
  │       │
  │       ▼
  │   Execute via MCP
  │       │
  │       ▼
  │   Validate
  │
  └── Unknown Incident
          │
          ▼
      AI Analysis
          │
          ▼
      Developer Review
          │
          ▼
      New Knowledge
```

---

# 14. Future Extensions

The schema can later be extended with:

- Teams and users
- RBAC
- Incident SLA tracking
- On-call rotations
- Alert sources
- Tool/MCP registry
- Agent evaluation metrics
- Prompt/version management
- Rollback workflows
- Approval policies
- Audit logs
- Cost/token tracking
- Incident relationships
- Root-cause graphs
- Automated postmortem generation

The core principle should remain:

> **The incident database records what happened, the agent tables record how AI reasoned about it, the automation tables record what actions were taken, and the knowledge tables record what the organization learned.**
