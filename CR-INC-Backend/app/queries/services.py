"""SQL for the service catalogue behind the dashboard's service filter."""

from __future__ import annotations

# Every service, ordered by name — not only those with incidents in the
# dashboard's current window. A filter that hides empty services cannot be used
# to find out that a service is empty, which is one of the things an operator
# most wants to confirm during an incident.
LIST = """
SELECT s.id, s.name
FROM services s
ORDER BY s.name
"""
