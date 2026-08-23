"""SQL-aware chunking.

A half-written CREATE FUNCTION retrieves as plausible SQL but is not runnable —
worse during an incident than retrieving nothing.
"""

from __future__ import annotations

from app.ingestion.chunking import chunk_sql, chunk_text, split_sql_statements

MIGRATION = """-- Orders schema
CREATE TABLE orders (
    id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'pending;not-a-boundary',
    total numeric(12,2)
);

CREATE INDEX orders_status_idx ON orders (status);

CREATE OR REPLACE FUNCTION order_total(order_id uuid) RETURNS numeric AS $$
BEGIN
    -- a semicolon in a comment; and one in the body:
    RETURN (SELECT total FROM orders WHERE id = order_id);
END;
$$ LANGUAGE plpgsql;
"""


def test_semicolons_inside_literals_do_not_split():
    statements = split_sql_statements(MIGRATION)
    assert len(statements) == 3
    assert "'pending;not-a-boundary'" in statements[0]


def test_dollar_quoted_body_stays_whole():
    statements = split_sql_statements(MIGRATION)
    function = [s for s in statements if "FUNCTION" in s][0]
    assert "RETURN (SELECT total" in function
    assert function.rstrip().endswith("LANGUAGE plpgsql;")


def test_block_comments_do_not_break_parsing():
    sql = "/* header; with semicolon */ CREATE TABLE a (id int); CREATE TABLE b (id int);"
    assert len(split_sql_statements(sql)) == 2


def test_objects_are_indexed_as_facets():
    chunks = chunk_sql(MIGRATION)
    objects = [o for c in chunks for o in c.metadata["sql_objects"]]
    assert "TABLE orders" in objects
    assert "INDEX orders_status_idx" in objects
    assert "FUNCTION order_total" in objects


def test_object_names_are_searchable_in_the_chunk_text():
    # DDL bodies often never repeat the object name, so it is prepended.
    chunk = chunk_sql(MIGRATION)[0]
    assert "TABLE orders" in chunk.content


def test_content_type_routes_to_the_sql_chunker():
    sql_chunks = chunk_text(MIGRATION, content_type="text/sql")
    md_chunks = chunk_text(MIGRATION, content_type="text/markdown")
    assert "sql_objects" in sql_chunks[0].metadata
    assert "sql_objects" not in md_chunks[0].metadata


def test_unterminated_trailing_statement_is_kept():
    assert len(split_sql_statements("CREATE TABLE a (id int); SELECT 1")) == 2
