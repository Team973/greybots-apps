-- Preflight, from the Oct 3 walkthrough: battery sets, a running total of Wh
-- discharged, and the shared pit timer.

-- Batteries are run in complete sets (e.g. one held back for the championship
-- event). Null = not assigned to a set.
ALTER TABLE public."PreflightBattery" ADD COLUMN IF NOT EXISTS "set_name" text;

-- Energy taken out of the battery in one use (a match or a test). Entered by
-- hand for now; match logs or charger telemetry can fill it later. The
-- Batteries page shows the sum over a battery's uses.
ALTER TABLE public."PreflightBatteryUse" ADD COLUMN IF NOT EXISTS "wh_discharged" numeric;

-- The pit timer: one row per timer ("key"), so the Overview and the pit
-- display on another device show the same countdown. It follows the Preflight
-- sync contract (see apps/preflight/docs/architecture.md).
CREATE TABLE IF NOT EXISTS public."PreflightTimer" (
    "id" uuid PRIMARY KEY,
    "key" text NOT NULL,
    -- The four digits dialed in, as MMSS (e.g. '0500'; each digit 0-9, so up
    -- to '9999' = 99 min 99 s).
    "set_digits" text NOT NULL DEFAULT '0500' CHECK ("set_digits" ~ '^[0-9]{4}$'),
    -- While running: when it reaches zero. Null when stopped or paused.
    "ends_at" timestamp with time zone,
    -- While paused: milliseconds left. Null otherwise.
    "paused_ms" integer,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_timer_synced_at_idx" ON public."PreflightTimer" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightTimer"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightTimer" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightTimer" TO anon;
GRANT ALL ON public."PreflightTimer" TO authenticated;
GRANT ALL ON public."PreflightTimer" TO service_role;

-- Anyone signed in can read it (the pit display is open to observers); the
-- pit crew (members and above) runs it.
CREATE POLICY "Enable read access for logged in users" ON public."PreflightTimer" FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for members" ON public."PreflightTimer" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.preflight_role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightTimer" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.preflight_role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.preflight_role IN ('member', 'lead', 'admin')));
