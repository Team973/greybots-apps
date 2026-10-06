-- Preflight: wiping an event's data once its report and data export have been
-- pulled (issue #110). Old events aren't kept in the database.
--
-- Preflight tables have no DELETE policy (deletes are soft, so they reach the
-- other devices), so rows can only really be removed through this function.
-- It removes every row recorded for one event, for Preflight admins only.
-- Batteries, their measurements and uses, shared settings, and the pit timer
-- belong to the team, not to an event, and are left alone.
--
-- Devices drop their own copies when they see the event's entry in the
-- `event_wipes` setting, which the app writes after this succeeds.
CREATE OR REPLACE FUNCTION "public"."preflight_wipe_event"("p_event_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  table_name text;
  removed bigint;
  counts jsonb := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "public"."User" u
    WHERE u."user_id" = auth.uid() AND NOT u."deactivated" AND u."preflight_role" = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only Preflight admins can wipe an event''s data' USING ERRCODE = '42501';
  END IF;

  IF p_event_key IS NULL OR btrim(p_event_key) = '' THEN
    RAISE EXCEPTION 'An event key is required';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'PreflightScheduleItem',
    'PreflightTask',
    'PreflightRobotStatusLog',
    'PreflightChecklistCheck',
    'PreflightChecklistRun',
    'PreflightNote',
    'PreflightRepair'
  ] LOOP
    EXECUTE format('DELETE FROM "public".%I WHERE "event_key" = $1', table_name) USING p_event_key;
    GET DIAGNOSTICS removed = ROW_COUNT;
    counts := counts || jsonb_build_object(table_name, removed);
  END LOOP;

  RETURN counts;
END;
$$;

ALTER FUNCTION "public"."preflight_wipe_event"("p_event_key" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.preflight_wipe_event(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preflight_wipe_event(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.preflight_wipe_event(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preflight_wipe_event(text) TO service_role;
