-- Preflight pit status flow and checklists (issues #82, #84, #86):
-- Inbound -> Pending (checklist 1..N of the configured sequence) -> Robot Ready
-- -> Away. Any pit crew member (member and above) drives the flow; leads keep
-- a manual override in the app. The checklist sequence and the pit roles
-- roster are PreflightSetting rows ('checklist_sequence', 'pit_roles').

-- 'in_pit' becomes 'inbound'.
ALTER TABLE public."PreflightRobotStatusLog" DROP CONSTRAINT "PreflightRobotStatusLog_status_check";
UPDATE public."PreflightRobotStatusLog" SET "status" = 'inbound' WHERE "status" = 'in_pit';
ALTER TABLE public."PreflightRobotStatusLog" ADD CONSTRAINT "PreflightRobotStatusLog_status_check"
    CHECK ("status" IN ('inbound', 'pending', 'ready', 'away'));

-- One "run" covers a robot's pit visit, from arrival through its checklists.
ALTER TABLE public."PreflightRobotStatusLog" ADD COLUMN IF NOT EXISTS "run_id" uuid;
-- Which checklist in the sequence is active (status 'pending'), 0-based.
ALTER TABLE public."PreflightRobotStatusLog" ADD COLUMN IF NOT EXISTS "checklist_index" smallint;
-- The match the robot left for (status 'away'); its end flips the robot to
-- inbound automatically.
ALTER TABLE public."PreflightRobotStatusLog" ADD COLUMN IF NOT EXISTS "match_key" text;

-- The whole pit crew moves the robot through the flow, not just leads.
DROP POLICY "Enable insert for leads and admins" ON public."PreflightRobotStatusLog";
DROP POLICY "Enable update for leads and admins" ON public."PreflightRobotStatusLog";
CREATE POLICY "Enable insert for members" ON public."PreflightRobotStatusLog" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightRobotStatusLog" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));

-- A checked-off checklist step within a run. The id is derived from
-- run + checklist + step, so two devices checking the same step converge on
-- one row. Unchecking sets completed_at back to null.
CREATE TABLE IF NOT EXISTS public."PreflightChecklistCheck" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "run_id" uuid NOT NULL,
    "checklist_id" text NOT NULL,
    "checklist_name" text,
    "step_id" text NOT NULL,
    "step_title" text,
    "completed_at" timestamp with time zone,
    "completed_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_checklist_check_synced_at_idx" ON public."PreflightChecklistCheck" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightChecklistCheck"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightChecklistCheck" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightChecklistCheck" TO anon;
GRANT ALL ON public."PreflightChecklistCheck" TO authenticated;
GRANT ALL ON public."PreflightChecklistCheck" TO service_role;

CREATE POLICY "Enable read access for members" ON public."PreflightChecklistCheck" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightChecklistCheck" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightChecklistCheck" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
