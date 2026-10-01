-- Preflight checklist instances (issue #82): steps can record a value, each
-- run of a checklist is tied to a match where that makes sense, and ad-hoc
-- checklists (start of day, a subsystem deep dive, a bumper swap) get their
-- own runs. Follows the Preflight sync contract (see
-- apps/preflight/docs/architecture.md).

-- What a step recorded beyond who and when: free text, 'pass' / 'fail', or a
-- battery number.
ALTER TABLE public."PreflightChecklistCheck" ADD COLUMN IF NOT EXISTS "value" text;
-- The match this run of the checklist belongs to (e.g. post-match: the match
-- just played; pre-match: the next one).
ALTER TABLE public."PreflightChecklistCheck" ADD COLUMN IF NOT EXISTS "match_key" text;

-- One run of an ad-hoc checklist. Its checked steps are PreflightChecklistCheck
-- rows with run_id = this row's id. snapshot is the checklist as it was when
-- the run started, so later edits to the template don't change the run.
-- (Runs of the standard pit sequence need no row here: the robot status log
-- records when each of those started.)
CREATE TABLE IF NOT EXISTS public."PreflightChecklistRun" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "checklist_id" text NOT NULL,
    "checklist_name" text NOT NULL,
    "snapshot" jsonb NOT NULL,
    "label" text,
    "match_key" text,
    "started_at" timestamp with time zone NOT NULL,
    "started_by_name" text,
    "completed_at" timestamp with time zone,
    "completed_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_checklist_run_synced_at_idx" ON public."PreflightChecklistRun" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightChecklistRun"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightChecklistRun" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightChecklistRun" TO anon;
GRANT ALL ON public."PreflightChecklistRun" TO authenticated;
GRANT ALL ON public."PreflightChecklistRun" TO service_role;

-- The whole pit crew (members and above) runs checklists.
CREATE POLICY "Enable read access for members" ON public."PreflightChecklistRun" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightChecklistRun" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightChecklistRun" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
