-- GreyScout updates for Tidal Tumble (issue #123).

-- 1. Match type on a match-scouting entry. Practice and playoff matches
--    reuse qualification match numbers, so this is what tells them apart.
--    Everything recorded so far is a qualification match.
ALTER TABLE public."MatchData"
    ADD COLUMN IF NOT EXISTS "prematch_match_type" text DEFAULT 'qual'::text NOT NULL;

ALTER TABLE public."MatchData"
    ADD CONSTRAINT "MatchData_match_type_check"
    CHECK ("prematch_match_type" = ANY (ARRAY['practice'::text, 'qual'::text, 'playoff'::text]));

-- 2. Personal alliance-selection predictions: one row per user per event,
--    the same shape as "Playoffs" (8 alliances of up to 4 team numbers, and
--    {"<match number>": <winning alliance number>}). Private to the user,
--    and never touches the pick list's picked teams.
CREATE TABLE IF NOT EXISTS public."PlayoffsPrediction" (
    "event_id" text NOT NULL REFERENCES public."Event"(event_id),
    "user_id" uuid DEFAULT auth.uid() NOT NULL REFERENCES public."User"(user_id),
    "alliances" jsonb DEFAULT '[[],[],[],[],[],[],[],[]]'::jsonb NOT NULL,
    "match_winners" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("event_id", "user_id")
);

ALTER TABLE public."PlayoffsPrediction" OWNER TO postgres;
ALTER TABLE public."PlayoffsPrediction" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."PlayoffsPrediction" FROM anon;
GRANT ALL ON public."PlayoffsPrediction" TO authenticated;
GRANT ALL ON public."PlayoffsPrediction" TO service_role;

-- A user reads and writes only their own prediction.
CREATE POLICY "Enable read access for own prediction" ON public."PlayoffsPrediction" FOR SELECT TO authenticated
    USING ("user_id" = auth.uid());
CREATE POLICY "Enable insert for own prediction" ON public."PlayoffsPrediction" FOR INSERT TO authenticated
    WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "Enable update for own prediction" ON public."PlayoffsPrediction" FOR UPDATE TO authenticated
    USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());

-- Same gate as the other GreyScout tables: an approved account.
CREATE POLICY "Require an approved account to read" ON public."PlayoffsPrediction" AS RESTRICTIVE FOR SELECT TO authenticated
    USING (( SELECT public.has_app_access('any'::text) AS has_app_access));
CREATE POLICY "Require scouting access to insert" ON public."PlayoffsPrediction" AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (( SELECT public.has_app_access('scouting'::text) AS has_app_access));
CREATE POLICY "Require scouting access to update" ON public."PlayoffsPrediction" AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (( SELECT public.has_app_access('scouting'::text) AS has_app_access));
