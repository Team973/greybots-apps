-- Preflight Overview (issues #81, #84, #86): operational tasks and the robot
-- readiness status log. Both follow the Preflight sync contract (see
-- apps/preflight/docs/architecture.md) and use the shared preflight_sync_row()
-- trigger from 20260929120000_add_preflight_schedule.sql.

-- Team operational tasks (e.g. "Swap battery"), per event. sort_order is a
-- float so a drag-reorder only rewrites the moved task (midpoint of its
-- neighbors).
CREATE TABLE IF NOT EXISTS public."PreflightTask" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "title" text NOT NULL,
    "notes" text,
    "sort_order" double precision NOT NULL DEFAULT 0,
    "match_key" text,
    "started_at" timestamp with time zone,
    "started_by_name" text,
    "completed_at" timestamp with time zone,
    "completed_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

-- Robot readiness status, as an append-only log: the current status is the
-- newest row for the event. Appending (rather than updating one row) keeps
-- the full history and means two devices can never overwrite each other.
CREATE TABLE IF NOT EXISTS public."PreflightRobotStatusLog" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "status" text NOT NULL CHECK ("status" IN ('in_pit', 'pending', 'ready', 'away')),
    -- What's pending, e.g. "Prematch Checklist" (status 'pending' only).
    "pending_label" text,
    "note" text,
    "set_at" timestamp with time zone NOT NULL,
    "set_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_task_synced_at_idx" ON public."PreflightTask" ("synced_at");
CREATE INDEX IF NOT EXISTS "preflight_robot_status_log_synced_at_idx" ON public."PreflightRobotStatusLog" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightTask"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();
CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightRobotStatusLog"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PreflightRobotStatusLog" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightTask" TO anon;
GRANT ALL ON public."PreflightTask" TO authenticated;
GRANT ALL ON public."PreflightTask" TO service_role;
GRANT ALL ON public."PreflightRobotStatusLog" TO anon;
GRANT ALL ON public."PreflightRobotStatusLog" TO authenticated;
GRANT ALL ON public."PreflightRobotStatusLog" TO service_role;

-- Tasks: the whole pit crew (members and above) can view, add, and check off.
CREATE POLICY "Enable read access for members" ON public."PreflightTask" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightTask" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightTask" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));

-- Robot status: members and above can view; only leads/admins set it.
CREATE POLICY "Enable read access for members" ON public."PreflightRobotStatusLog" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for leads and admins" ON public."PreflightRobotStatusLog" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable update for leads and admins" ON public."PreflightRobotStatusLog" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
