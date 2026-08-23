"""Parsing the diff a planner proposes.

This is where a model's text becomes something an operator reads as if it were
the repository. Getting a line number wrong here means showing a change against
the wrong line of a real file.
"""

from app.agents.patch import parse_unified_diff

DIFF = """--- a/infra/payments-db/pgbouncer.tf
+++ b/infra/payments-db/pgbouncer.tf
@@ -41,6 +41,7 @@ resource "aws_db_proxy" "payments" {
   name = "payments-db-primary"
-  max_connections_percent      = 60
+  max_connections_percent      = 100
-  max_idle_connections_percent = 20
+  max_idle_connections_percent = 35
+  connection_borrow_timeout    = 30
 }
"""


class TestParseUnifiedDiff:
    def test_reads_the_file_path_from_the_new_side(self):
        result = parse_unified_diff(DIFF)
        assert [f["path"] for f in result["files"]] == ["infra/payments-db/pgbouncer.tf"]

    def test_counts_additions_and_deletions(self):
        result = parse_unified_diff(DIFF)
        assert result["additions"] == 3
        assert result["deletions"] == 2

    def test_numbers_lines_from_the_hunk_header_not_from_one(self):
        # The viewer shows the file's real line numbers. Counting from 1 would
        # point a reviewer at the wrong part of the file.
        lines = parse_unified_diff(DIFF)["files"][0]["hunks"][0]["lines"]
        first_context = next(line for line in lines if line["kind"] == "context")
        assert first_context["old"] == 41 and first_context["new"] == 41

    def test_added_lines_have_no_old_number_and_removed_have_no_new(self):
        lines = parse_unified_diff(DIFF)["files"][0]["hunks"][0]["lines"]
        added = next(line for line in lines if line["kind"] == "add")
        removed = next(line for line in lines if line["kind"] == "del")
        assert added["old"] is None and added["new"] is not None
        assert removed["new"] is None and removed["old"] is not None

    def test_keeps_the_hunk_context_header(self):
        hunk = parse_unified_diff(DIFF)["files"][0]["hunks"][0]
        assert hunk["header"] == 'resource "aws_db_proxy" "payments" {'

    def test_handles_several_files(self):
        two = DIFF + """--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-old title
+new title
"""
        result = parse_unified_diff(two)
        assert [f["path"] for f in result["files"]] == [
            "infra/payments-db/pgbouncer.tf",
            "README.md",
        ]
        assert result["additions"] == 4 and result["deletions"] == 3

    def test_ignores_the_no_newline_marker(self):
        # "\\ No newline at end of file" is metadata; counted as a line it would
        # appear in the viewer as a phantom row.
        diff = DIFF + "\\ No newline at end of file\n"
        assert parse_unified_diff(diff)["additions"] == 3

    def test_unparseable_input_is_no_change_not_an_empty_change(self):
        assert parse_unified_diff("the runbook does not describe a code change")["files"] == []
        assert parse_unified_diff("")["files"] == []

    def test_tolerates_a_git_style_header(self):
        diff = "diff --git a/x.tf b/x.tf\n" + DIFF
        assert len(parse_unified_diff(diff)["files"]) == 1
