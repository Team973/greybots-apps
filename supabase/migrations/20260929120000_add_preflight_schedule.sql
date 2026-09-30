-- Preflight schedule (issue #85): the first Preflight synced tables.
-- See apps/preflight/docs/architecture.md ("Sync engine") for the sync contract.

-- Shared trigger for every Preflight synced table: last-write-wins on the
-- client-set updated_at, plus a server-assigned synced_at pull cursor.
CREATE OR REPLACE FUNCTION public.preflight_sync_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Drop an incoming update that's older than the stored row.
  IF TG_OP = 'UPDATE' AND NEW.updated_at < OLD.updated_at THEN
    RETURN NULL;
  END IF;
  -- clock_timestamp(), not now(), so rows in one transaction still get
  -- distinct, increasing cursor values.
  NEW.synced_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Shared key/value settings (e.g. key 'active_event' holds the event key,
-- team number, and event dates the schedule is built around).
CREATE TABLE IF NOT EXISTS public."PreflightSetting" (
    "id" uuid PRIMARY KEY,
    "key" text NOT NULL UNIQUE,
    "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

-- Calendar entries: TBA matches for our team (kind 'match', id derived from
-- the TBA match key so every device importing produces the same row) and
-- custom events created by leads/admins (kind 'custom').
CREATE TABLE IF NOT EXISTS public."PreflightScheduleItem" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "kind" text NOT NULL CHECK ("kind" IN ('match', 'custom')),
    "category" text NOT NULL CHECK ("category" IN ('event', 'match', 'pit', 'admin')),
    "title" text NOT NULL,
    "notes" text,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "match_key" text,
    "match_info" jsonb,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_setting_synced_at_idx" ON public."PreflightSetting" ("synced_at");
CREATE INDEX IF NOT EXISTS "preflight_schedule_item_synced_at_idx" ON public."PreflightScheduleItem" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightSetting"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();
CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightScheduleItem"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PreflightScheduleItem" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightSetting" TO anon;
GRANT ALL ON public."PreflightSetting" TO authenticated;
GRANT ALL ON public."PreflightSetting" TO service_role;
GRANT ALL ON public."PreflightScheduleItem" TO anon;
GRANT ALL ON public."PreflightScheduleItem" TO authenticated;
GRANT ALL ON public."PreflightScheduleItem" TO service_role;

-- Members and above can view; only leads/admins can change. Deletes are soft
-- (deleted = true via UPDATE), so there's no DELETE policy.
CREATE POLICY "Enable read access for members" ON public."PreflightSetting" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for leads and admins" ON public."PreflightSetting" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable update for leads and admins" ON public."PreflightSetting" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));

CREATE POLICY "Enable read access for members" ON public."PreflightScheduleItem" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for leads and admins" ON public."PreflightScheduleItem" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable update for leads and admins" ON public."PreflightScheduleItem" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
