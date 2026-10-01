-- Preflight repair and maintenance log (issue #83). Follows the Preflight
-- sync contract (see apps/preflight/docs/architecture.md) and uses the shared
-- preflight_sync_row() trigger.

-- One repair or maintenance job. Links (requirements §6.2): match_key (one
-- of our matches), robot, subsystem, and component are optional; task_id is
-- the PreflightTask it was logged from, and run_id the pit visit (checklist
-- run) it was found in. component is free text until the inventory exists.
CREATE TABLE IF NOT EXISTS public."PreflightRepair" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "title" text NOT NULL,
    "details" text,
    "subsystem" text,
    "component" text,
    "robot" text,
    "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'in_progress', 'done')),
    "assignee" text,
    "match_key" text,
    "task_id" uuid,
    "run_id" uuid,
    "source" text NOT NULL DEFAULT 'standalone' CHECK ("source" IN ('standalone', 'task', 'checklist')),
    "reported_at" timestamp with time zone NOT NULL,
    "reported_by_name" text,
    "started_at" timestamp with time zone,
    "started_by_name" text,
    "finished_at" timestamp with time zone,
    "finished_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_repair_synced_at_idx" ON public."PreflightRepair" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightRepair"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightRepair" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightRepair" TO anon;
GRANT ALL ON public."PreflightRepair" TO authenticated;
GRANT ALL ON public."PreflightRepair" TO service_role;

-- The whole pit crew (members and above) logs and works repairs.
CREATE POLICY "Enable read access for members" ON public."PreflightRepair" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightRepair" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightRepair" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
