-- 003_functions.sql
-- Shared trigger functions.

-- Keeps updated_at honest without every caller having to remember it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
