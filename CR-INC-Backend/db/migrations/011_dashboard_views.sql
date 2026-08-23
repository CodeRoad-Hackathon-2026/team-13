-- 011_dashboard_views.sql
-- Schema doc section 10 — the dashboard metrics as views, so the API layer and the
-- doc cannot drift apart. Optional: drop this file's views without affecting the model.

-- One row, every headline KPI.
CREATE OR REPLACE VIEW v_incident_kpis AS
SELECT
    (SELECT COUNT(*) FROM incidents
        WHERE status NOT IN ('RESOLVED', 'CLOSED'))          AS open_incidents,
    (SELECT COUNT(*) FROM incidents)                          AS total_incidents,
    (SELECT COUNT(*) FROM incidents WHERE is_known_incident)  AS known_incidents,
    (SELECT AVG(resolved_at - created_at) FROM incidents
        WHERE resolved_at IS NOT NULL)                        AS average_resolution_time,
    (SELECT COUNT(*) FILTER (WHERE status = 'SUCCESS') * 100.0 / NULLIF(COUNT(*), 0)
        FROM executed_actions)                                AS automation_success_rate;

CREATE OR REPLACE VIEW v_incidents_by_priority AS
SELECT priority, COUNT(*) AS incident_count
FROM incidents
GROUP BY priority
ORDER BY priority;

CREATE OR REPLACE VIEW v_incidents_by_category AS
SELECT category, COUNT(*) AS incident_count
FROM incidents
GROUP BY category
ORDER BY COUNT(*) DESC;

CREATE OR REPLACE VIEW v_incidents_by_status AS
SELECT status, COUNT(*) AS incident_count
FROM incidents
GROUP BY status
ORDER BY status;

CREATE OR REPLACE VIEW v_known_vs_unknown_incidents AS
SELECT is_known_incident, COUNT(*) AS incident_count
FROM incidents
GROUP BY is_known_incident;

-- Flattened timeline for the incident detail screen.
CREATE OR REPLACE VIEW v_incident_timeline AS
SELECT
    e.incident_id,
    i.title AS incident_title,
    i.status AS incident_status,
    e.created_at,
    e.event_type,
    e.description,
    e.created_by,
    e.payload
FROM incident_events e
JOIN incidents i ON i.id = e.incident_id
ORDER BY e.incident_id, e.created_at;

-- Agent health: success rate, latency and token cost per agent.
CREATE OR REPLACE VIEW v_agent_performance AS
SELECT
    a.name AS agent_name,
    a.version,
    COUNT(r.id) AS total_runs,
    COUNT(*) FILTER (WHERE r.status = 'SUCCESS') AS successful_runs,
    COUNT(*) FILTER (WHERE r.status = 'FAILED')  AS failed_runs,
    COUNT(*) FILTER (WHERE r.status = 'SUCCESS') * 100.0
        / NULLIF(COUNT(r.id), 0) AS success_rate,
    AVG(r.confidence_score) AS avg_confidence_score,
    AVG(r.latency_ms)       AS avg_latency_ms,
    SUM(r.tokens_input)     AS total_tokens_input,
    SUM(r.tokens_output)    AS total_tokens_output
FROM agents a
LEFT JOIN agent_runs r ON r.agent_id = a.id
GROUP BY a.id, a.name, a.version
ORDER BY a.name;
