-- Workshop: key milestones on the schedule, and a shop boss for each session.
--
-- * WorkshopKeyDate: a date (or run of days) leads and admins mark on the
--   Sessions calendar, such as "Robot reveal" or "Drive team practice". It
--   shows in the calendar's all-day row next to the team's competition
--   events (which come from GreyScout's Event table and aren't kept here).
--   It's only a date on the calendar; ticket milestones (WorkshopMilestone)
--   are separate.
-- * WorkshopSession.shop_boss: the person running that session. Leads and
--   admins set it, like the rest of a session. Every session made before
--   this migration starts out with Allen Bailey.

-- ---------------------------------------------------------------------------
-- Key dates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."WorkshopKeyDate" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    -- The days it covers, inclusive.
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "notes" text NOT NULL DEFAULT '',
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL,
    CONSTRAINT "WorkshopKeyDate_range_check" CHECK ("end_date" >= "start_date")
);

CREATE INDEX IF NOT EXISTS "workshop_key_date_start_idx" ON public."WorkshopKeyDate" ("start_date");

ALTER TABLE public."WorkshopKeyDate" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."WorkshopKeyDate" TO authenticated, service_role;

CREATE POLICY "Enable read access for Workshop" ON public."WorkshopKeyDate" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopKeyDate" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopKeyDate" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopKeyDate" FOR DELETE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin'));

-- ---------------------------------------------------------------------------
-- Shop boss
-- ---------------------------------------------------------------------------

ALTER TABLE public."WorkshopSession"
    ADD COLUMN IF NOT EXISTS "shop_boss" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL;

-- The sessions already on the schedule are Allen Bailey's. Matched by name,
-- so if there isn't exactly one Allen Bailey this leaves them empty (and says
-- so) for a lead to fill in.
DO $$
DECLARE
    boss uuid;
    matches integer;
BEGIN
    SELECT count(*), min("user_id"::text)::uuid INTO matches, boss
        FROM public."User" WHERE lower(btrim("name")) = 'allen bailey';
    IF matches = 1 THEN
        UPDATE public."WorkshopSession" SET "shop_boss" = boss WHERE "shop_boss" IS NULL;
    ELSE
        RAISE NOTICE 'Found % users named Allen Bailey; existing sessions were left without a shop boss.', matches;
    END IF;
END $$;
