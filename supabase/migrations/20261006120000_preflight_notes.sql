-- Preflight notes (issue #88): quick, timestamped pit notes. Follows the
-- Preflight sync contract (see apps/preflight/docs/architecture.md) and uses
-- the shared preflight_sync_row() trigger.

-- sort_order is a float so a drag-reorder only rewrites the moved note.
-- match_key, robot, and subsystem are optional links (requirements §6.2).
CREATE TABLE IF NOT EXISTS public."PreflightNote" (
    "id" uuid PRIMARY KEY,
    "event_key" text NOT NULL,
    "title" text NOT NULL DEFAULT '',
    "body" text NOT NULL DEFAULT '',
    "sort_order" double precision NOT NULL DEFAULT 0,
    "match_key" text,
    "robot" text,
    "subsystem" text,
    "noted_at" timestamp with time zone NOT NULL,
    "created_by_name" text,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean NOT NULL DEFAULT false,
    "synced_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    "updated_by_name" text
);

CREATE INDEX IF NOT EXISTS "preflight_note_synced_at_idx" ON public."PreflightNote" ("synced_at");

CREATE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON public."PreflightNote"
    FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

ALTER TABLE public."PreflightNote" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."PreflightNote" TO anon;
GRANT ALL ON public."PreflightNote" TO authenticated;
GRANT ALL ON public."PreflightNote" TO service_role;

-- The whole pit crew (members and above) can read and write notes.
CREATE POLICY "Enable read access for members" ON public."PreflightNote" FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable insert for members" ON public."PreflightNote" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
CREATE POLICY "Enable update for members" ON public."PreflightNote" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('member', 'lead', 'admin')));
