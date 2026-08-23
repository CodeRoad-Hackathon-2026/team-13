-- 001_agents.sql
-- The agent registry from schema doc section 5.1. Safe to re-run.

INSERT INTO agents (name, description, version) VALUES
    ('Incident Intake Agent',
     'Parses inbound email, Slack, PagerDuty and API payloads into an incident record.', '1'),
    ('Classification Agent',
     'Assigns category, priority, affected service and environment to an incident.', '1'),
    ('RAG Retrieval Agent',
     'Searches the knowledge base for similar incidents, runbooks and postmortems.', '1'),
    ('Decision Agent',
     'Decides whether the incident is known and proposes remediation actions.', '1'),
    ('Execution Agent',
     'Executes approved actions through the registered MCP tools.', '1'),
    ('Validation Agent',
     'Verifies that an executed action resolved the incident.', '1'),
    ('Knowledge Generation Agent',
     'Turns resolved incidents into knowledge documents for future retrieval.', '1'),
    ('Change Delivery Agent',
     'Clones the target repository, proves an approved code change applies, and pushes a branch to open a pull request from.', '1')
ON CONFLICT (name) DO NOTHING;
