-- Preflight batteries (issue #87): the battery registry, manual measurements,
-- and which battery was in the robot when. All three follow the Preflight
-- sync contract (see apps/preflight/docs/architecture.md) and use the shared
-- preflight_sync_row() trigger.

-- One row per physical battery. Batteries belong to the team, not to an
-- event. The id is derived from the number, so two devices registering
-- battery 7 converge on one row.
CREATE TABLE IF NOT EXISTS public."PreflightBattery" (
    "id" uuid PRIMARY KEY,
    "number" integer NOT NULL,
    "label" text,
    "purchase_date" date,
    "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspect', 'retired')),
    "notes" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

-- A manual measurement. Every value is optional, so a quick voltage check and
-- a full battery-analyzer reading are both one row. Charger telemetry (a
-- future release) can add rows here with its own source.
CREATE TABLE IF NOT EXISTS public."PreflightBatteryMeasurement" (
    "id" uuid PRIMARY KEY,
    "battery_id" uuid NOT NULL,
    "measured_at" timestamp with time zone NOT NULL,
    "resting_voltage" numeric,
    "internal_resistance_mohm" numeric,
    "state_of_charge" numeric,
    "capacity_wh" numeric,
    "observations" text,
    "source" text NOT NULL DEFAULT 'manual',
    "measured_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

-- A battery going into the robot for a match or a test. removed_at is null
-- while it's installed; the newest open row is the installed battery.
CREATE TABLE IF NOT EXISTS public."PreflightBatteryUse" (
    "id" uuid PRIMARY KEY,
    "battery_id" uuid NOT NULL,
    "event_key" text,
    "kind" text NOT NULL DEFAULT 'match' CHECK ("kind" IN ('match', 'test', 'other')),
    "match_key" text,
    "label" text,
    "run_id" uuid,
    "installed_at" timestamp with time zone NOT NULL,
    "installed_by_name" text,
    "removed_at" timestamp with time zone,
    "removed_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_battery_synced_at_idx" ON public."PreflightBattery" ("synced_at");
CREATE INDEX IF NOT EXISTS "preflight_battery_measurement_synced_at_idx" ON public."PreflightBatteryMeasurement" ("synced_at");
CREATE INDEX IF NOT EXISTS "preflight_battery_use_synced_at_idx" ON public."PreflightBatteryUse" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightBattery"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();
CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightBatteryMeasurement"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();
CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightBatteryUse"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightBattery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PreflightBatteryMeasurement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PreflightBatteryUse" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightBattery" TO anon;
GRANT ALL ON public."PreflightBattery" TO authenticated;
GRANT ALL ON public."PreflightBattery" TO service_role;
GRANT ALL ON public."PreflightBatteryMeasurement" TO anon;
GRANT ALL ON public."PreflightBatteryMeasurement" TO authenticated;
GRANT ALL ON public."PreflightBatteryMeasurement" TO service_role;
GRANT ALL ON public."PreflightBatteryUse" TO anon;
GRANT ALL ON public."PreflightBatteryUse" TO authenticated;
GRANT ALL ON public."PreflightBatteryUse" TO service_role;

-- The whole pit crew (members and above) registers, measures, and assigns
-- batteries.
CREATE POLICY "Enable read access for members" ON public."PreflightBattery" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightBattery" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightBattery" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));

CREATE POLICY "Enable read access for members" ON public."PreflightBatteryMeasurement" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightBatteryMeasurement" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightBatteryMeasurement" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));

CREATE POLICY "Enable read access for members" ON public."PreflightBatteryUse" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightBatteryUse" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightBatteryUse" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
