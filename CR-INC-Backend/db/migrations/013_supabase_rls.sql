-- 013_supabase_rls.sql
-- Closes the hole that only exists on Supabase.
--
-- Supabase puts PostgREST in front of the `public` schema and grants the `anon`
-- and `authenticated` roles privileges on new objects there by default. Every
-- table the previous twelve migrations create would therefore be readable — and
-- writable — by anyone holding the project's anon key, which is a key that ships
-- inside a browser bundle. An incident log, an approval audit trail and a table
-- of remediation commands are not that.
--
-- Nothing in this architecture needs PostgREST: the dashboard talks to nginx,
-- nginx proxies /api to the orchestrator, and the orchestrator is the only thing
-- that touches Postgres. So the right policy is "no API access at all", not
-- "API access with rules".
--
-- Two mechanisms, because they cover different objects:
--
--   * RLS on the base tables. Enabled with zero policies, anon and authenticated
--     see no rows and can write none. The orchestrator is unaffected: it connects
--     as the table owner, and an owner bypasses RLS — which is exactly why
--     FORCE ROW LEVEL SECURITY is deliberately not used here.
--
--   * REVOKE on the views. RLS does not protect a view: a view executes with its
--     owner's rights, so v_incident_kpis would happily read `incidents` on anon's
--     behalf. Privileges are the only lever, plus security_invoker so the view
--     stops lending out its owner's rights in the first place.
--
-- Runs cleanly on plain PostgreSQL too — the anon/authenticated roles do not
-- exist there, so the guarded block is skipped and only RLS is applied.

-- --- base tables ------------------------------------------------------------
-- Every table in public, not a hardcoded list, so schema_migrations is covered
-- and migration 014 cannot forget to come back here.

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        RAISE NOTICE 'RLS enabled on %', t;
    END LOOP;
END $$;

-- --- views ------------------------------------------------------------------

DO $$
DECLARE
    v TEXT;
BEGIN
    FOR v IN
        SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
        ORDER BY table_name
    LOOP
        -- PostgreSQL 15+, which every current Supabase project is. Makes the view
        -- run with the caller's rights, so the tables' RLS applies through it.
        BEGIN
            EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'security_invoker unsupported here; % relies on REVOKE alone', v;
        END;
    END LOOP;
END $$;

-- --- the Supabase API roles -------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        RAISE NOTICE 'not a Supabase database (no anon role) - RLS applied, nothing to revoke';
        RETURN;
    END IF;

    -- Belt to RLS's braces on the tables, and the views' only protection.
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';

    -- Without this, the next migration silently re-opens whatever it creates.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
END $$;
