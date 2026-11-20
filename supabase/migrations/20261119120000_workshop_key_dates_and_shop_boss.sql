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
-- * WorkshopSession.kind: what a session is, 'shop' (a shop session, as
--   every one so far) or 'driver_practice'. They're coloured differently on
--   the schedule. Only shop sessions count as shop time (sessions left before
--   an event, burnup forecasts), and plans carry over from one shop session
--   to the next, skipping driver practice.

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

-- ---------------------------------------------------------------------------
-- Session kinds
-- ---------------------------------------------------------------------------

ALTER TABLE public."WorkshopSession"
    ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'shop' CHECK ("kind" IN ('shop', 'driver_practice'));

-- A session's plan starts from the previous *shop* session's (driver
-- practice in between is skipped), and driver practice doesn't carry
-- anything over. Otherwise as in 20261019120000_workshop_app.sql.
CREATE OR REPLACE FUNCTION "public"."workshop_seed_session_plan"("p_session_id" uuid, "p_force" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  this_session public."WorkshopSession";
  previous_id uuid;
  next_order double precision;
  added integer := 0;
BEGIN
  IF NOT public.has_app_access('workshop') THEN
    RAISE EXCEPTION 'Workshop access is required' USING ERRCODE = '42501';
  END IF;
  IF p_force AND public.workshop_role() NOT IN ('lead', 'admin') THEN
    RAISE EXCEPTION 'Only leads and admins plan sessions' USING ERRCODE = '42501';
  END IF;

  -- Locked, so two people opening the session at once seed it only once.
  SELECT * INTO this_session FROM public."WorkshopSession" WHERE "id" = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session';
  END IF;
  IF this_session."plan_seeded" AND NOT p_force THEN
    RETURN 0;
  END IF;

  -- Only shop sessions carry plans over; driver practice starts empty.
  IF this_session."kind" <> 'shop' THEN
    UPDATE public."WorkshopSession" SET "plan_seeded" = true WHERE "id" = p_session_id;
    RETURN 0;
  END IF;

  SELECT s."id" INTO previous_id FROM public."WorkshopSession" s
    WHERE s."starts_at" < this_session."starts_at" AND s."kind" = 'shop'
    ORDER BY s."starts_at" DESC LIMIT 1;

  IF previous_id IS NOT NULL THEN
    -- A previous session nobody opened hasn't had its own plan carried over
    -- yet; do that first so unfinished tickets aren't lost along the way.
    IF NOT (SELECT "plan_seeded" FROM public."WorkshopSession" WHERE "id" = previous_id) THEN
      PERFORM public.workshop_seed_session_plan(previous_id, false);
    END IF;

    SELECT COALESCE(max(st."sort_order"), 0) INTO next_order FROM public."WorkshopSessionTicket" st WHERE st."session_id" = p_session_id;
    INSERT INTO public."WorkshopSessionTicket" ("session_id", "ticket_id", "sort_order", "carried_over", "added_by")
      SELECT p_session_id, pt."ticket_id", next_order + row_number() OVER (ORDER BY pt."sort_order"), true, NULL
      FROM public."WorkshopSessionTicket" pt
      JOIN public."WorkshopTicket" t ON t."id" = pt."ticket_id"
      WHERE pt."session_id" = previous_id AND t."status" <> 'closed'
      ON CONFLICT ("session_id", "ticket_id") DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
  END IF;

  UPDATE public."WorkshopSession" SET "plan_seeded" = true WHERE "id" = p_session_id;
  RETURN added;
END;
$$;
