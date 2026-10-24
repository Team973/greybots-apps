-- Workshop: the shop management app (issue #114). Tickets, milestones, shop
-- sessions and their plans, and GreyPoints (bounties, recognitions, and a
-- rewards marketplace).
--
-- * A third per-app role, "workshop_role", managed from the same People page
--   as the others.
-- * Anyone in Workshop (members and above) can open and edit tickets; only
--   leads and admins close or reopen them, plan sessions, and manage
--   milestones, components, and rewards. Observers can look but not change
--   anything.
-- * The GreyPoints rules live here rather than in the app, so they hold no
--   matter which client writes: bounties come from a fixed list, nobody sets a
--   bounty on a ticket they own or are assigned to, a bounty set by someone
--   who later joins the ticket is cleared, and points are only paid out when a
--   ticket is closed as complete.

-- ---------------------------------------------------------------------------
-- The Workshop role
-- ---------------------------------------------------------------------------

-- Everyone starts with the role they have in scouting, as Preflight did when
-- it got its own role. A deactivated account stays deactivated, and gets its
-- scouting role back here too when it's restored. (Migrations run with no
-- auth context, so the role trigger lets this update through.)
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "workshop_role" text NOT NULL DEFAULT 'pending';
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "prior_workshop_role" text;
UPDATE public."User" SET "workshop_role" = "role", "prior_workshop_role" = "prior_role";
ALTER TABLE public."User" ADD CONSTRAINT "User_workshop_role_check"
    CHECK ("workshop_role" IN ('admin', 'lead', 'member', 'observer', 'pending', 'deactivated'));

ALTER TABLE public."User" DROP CONSTRAINT "User_deactivated_check";
ALTER TABLE public."User" ADD CONSTRAINT "User_deactivated_check" CHECK (
    ("deactivated" AND "role" = 'deactivated' AND "preflight_role" = 'deactivated' AND "workshop_role" = 'deactivated')
    OR (NOT "deactivated" AND "role" <> 'deactivated' AND "preflight_role" <> 'deactivated' AND "workshop_role" <> 'deactivated')
);

CREATE OR REPLACE FUNCTION "public"."enforce_user_profile_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- No auth context (service_role / server-side jobs) may create any row.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- A new account always starts pending in every app, whatever the client
  -- sent: a lead or admin has to give it a role before it can see anything.
  NEW."role" := 'pending';
  NEW."preflight_role" := 'pending';
  NEW."workshop_role" := 'pending';
  NEW."deactivated" := false;
  NEW."prior_role" := NULL;
  NEW."prior_preflight_role" := NULL;
  NEW."prior_workshop_role" := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_user_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  actor_preflight_role text;
  actor_workshop_role text;
  actor_is_admin boolean;
BEGIN
  -- No auth context (service_role / server-side jobs) bypasses the checks below.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "role", "preflight_role", "workshop_role" INTO actor_role, actor_preflight_role, actor_workshop_role
    FROM "public"."User" WHERE "user_id" = actor_id;
  -- An admin of any app can deactivate, restore, and rename people.
  actor_is_admin := actor_role = 'admin' OR actor_preflight_role = 'admin' OR actor_workshop_role = 'admin';

  -- The account a row belongs to, when it was created, and the roles saved at
  -- deactivation are never edited directly.
  NEW."user_id" := OLD."user_id";
  NEW."created_at" := OLD."created_at";

  -- Deactivating or restoring an account. Deactivating takes away the roles
  -- in every app (so every role check denies access) and remembers them;
  -- restoring puts them back.
  IF NEW."deactivated" IS DISTINCT FROM OLD."deactivated" THEN
    IF NOT COALESCE(actor_is_admin, false) THEN
      RAISE EXCEPTION 'Only admins may deactivate or restore users';
    END IF;
    IF NEW."deactivated" THEN
      IF OLD."user_id" = actor_id THEN
        RAISE EXCEPTION 'You cannot deactivate your own account';
      END IF;
      IF OLD."role" = 'admin' OR OLD."preflight_role" = 'admin' OR OLD."workshop_role" = 'admin' THEN
        RAISE EXCEPTION 'Admins cannot be deactivated';
      END IF;
      NEW."prior_role" := OLD."role";
      NEW."prior_preflight_role" := OLD."preflight_role";
      NEW."prior_workshop_role" := OLD."workshop_role";
      NEW."role" := 'deactivated';
      NEW."preflight_role" := 'deactivated';
      NEW."workshop_role" := 'deactivated';
    ELSE
      NEW."role" := COALESCE(OLD."prior_role", 'pending');
      NEW."preflight_role" := COALESCE(OLD."prior_preflight_role", 'pending');
      NEW."workshop_role" := COALESCE(OLD."prior_workshop_role", 'pending');
      NEW."prior_role" := NULL;
      NEW."prior_preflight_role" := NULL;
      NEW."prior_workshop_role" := NULL;
    END IF;
    NEW."name" := OLD."name";
    RETURN NEW;
  END IF;

  NEW."prior_role" := OLD."prior_role";
  NEW."prior_preflight_role" := OLD."prior_preflight_role";
  NEW."prior_workshop_role" := OLD."prior_workshop_role";

  -- Roles are per app: a person's role in each app is changed by someone with
  -- enough authority in that same app.
  PERFORM "public"."check_app_role_change"('scouting', actor_role, OLD."role", NEW."role");
  PERFORM "public"."check_app_role_change"('Preflight', actor_preflight_role, OLD."preflight_role", NEW."preflight_role");
  PERFORM "public"."check_app_role_change"('Workshop', actor_workshop_role, OLD."workshop_role", NEW."workshop_role");

  IF NEW."name" IS DISTINCT FROM OLD."name" AND actor_id IS DISTINCT FROM NEW."user_id" AND NOT COALESCE(actor_is_admin, false) THEN
    RAISE EXCEPTION 'Only admins may change another user''s name';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."has_app_access"("app" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Whether the signed-in account has been given a role in the app
  -- ('scouting', 'preflight', or 'workshop'), or in any app ('any'). Pending
  -- and deactivated accounts have none.
  SELECT EXISTS (
    SELECT 1 FROM "public"."User" u
    WHERE u."user_id" = auth.uid()
      AND NOT u."deactivated"
      AND (
        (app IN ('scouting', 'any') AND u."role" IN ('observer', 'member', 'lead', 'admin'))
        OR (app IN ('preflight', 'any') AND u."preflight_role" IN ('observer', 'member', 'lead', 'admin'))
        OR (app IN ('workshop', 'any') AND u."workshop_role" IN ('observer', 'member', 'lead', 'admin'))
      )
  );
$$;

-- The signed-in account's Workshop role ('pending' when there's none), for
-- the policies and triggers below.
CREATE OR REPLACE FUNCTION "public"."workshop_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT u."workshop_role" FROM "public"."User" u WHERE u."user_id" = auth.uid() AND NOT u."deactivated"),
    'pending'
  );
$$;

REVOKE ALL ON FUNCTION public.workshop_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workshop_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_role() TO service_role;

-- ---------------------------------------------------------------------------
-- Components and milestones
-- ---------------------------------------------------------------------------

-- The parts of the team a ticket touches (Mechanical, Electrical, ...).
-- Archived rather than deleted, so old tickets keep their labels.
CREATE TABLE IF NOT EXISTS public."WorkshopComponent" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    "color" text,
    "sort_order" double precision NOT NULL DEFAULT 0,
    "archived" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."WorkshopMilestone" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    "description" text NOT NULL DEFAULT '',
    "target_date" date,
    -- Set when the milestone is finished with; it drops off the active list.
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."WorkshopTicket" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The short number people call a ticket by ("#42").
    "number" integer GENERATED ALWAYS AS IDENTITY UNIQUE,
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    "description" text NOT NULL DEFAULT '',
    "milestone_id" uuid REFERENCES public."WorkshopMilestone"("id") ON DELETE SET NULL,
    "component_ids" uuid[] NOT NULL DEFAULT '{}',
    -- Responsible for the ticket succeeding.
    "owner_id" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    -- Doing the work.
    "assignee_ids" uuid[] NOT NULL DEFAULT '{}',
    -- The estimated completion date.
    "due_date" date,
    "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'in_progress', 'closed')),
    "close_reason" text CHECK ("close_reason" IN ('complete', 'duplicate', 'wont_do')),
    "closed_at" timestamp with time zone,
    "closed_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    -- GreyPoints for completing it, from a fixed list (see
    -- workshop_bounty_options()), and who set it.
    "bounty" integer CHECK ("bounty" IN (5, 10, 25, 50, 100)),
    "bounty_set_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "WorkshopTicket_closed_check" CHECK (("status" = 'closed') = ("close_reason" IS NOT NULL AND "closed_at" IS NOT NULL)),
    CONSTRAINT "WorkshopTicket_bounty_set_by_check" CHECK ("bounty" IS NULL OR "bounty_set_by" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "workshop_ticket_milestone_idx" ON public."WorkshopTicket" ("milestone_id");
CREATE INDEX IF NOT EXISTS "workshop_ticket_owner_idx" ON public."WorkshopTicket" ("owner_id");
CREATE INDEX IF NOT EXISTS "workshop_ticket_assignees_idx" ON public."WorkshopTicket" USING gin ("assignee_ids");
CREATE INDEX IF NOT EXISTS "workshop_ticket_status_idx" ON public."WorkshopTicket" ("status");

COMMENT ON COLUMN public."WorkshopTicket"."bounty" IS 'GreyPoints paid out when the ticket is closed as complete. Never set by the owner or an assignee.';

-- The bounty values a ticket can have, smallest first.
CREATE OR REPLACE FUNCTION "public"."workshop_bounty_options"() RETURNS integer[]
    LANGUAGE "sql" IMMUTABLE
    AS $$ SELECT ARRAY[5, 10, 25, 50, 100] $$;

-- Who's allowed to do what to a ticket.
-- * Members and above open and edit tickets; observers can't (RLS).
-- * Only leads and admins close or reopen one, and a closed ticket can't be
--   edited until it's reopened (except to move it to another milestone, which
--   is also what deleting its milestone does).
-- * The bounty is set by a lead or admin who isn't the owner or an assignee,
--   and is cleared if whoever set it later becomes the owner or an assignee.
CREATE OR REPLACE FUNCTION "public"."enforce_workshop_ticket"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_is_lead boolean := public.workshop_role() IN ('lead', 'admin');
  actor_interested boolean;
  unmoved public."WorkshopTicket";
BEGIN
  -- Each person once, in the order they were added.
  NEW."assignee_ids" := COALESCE(ARRAY(
    SELECT a FROM unnest(NEW."assignee_ids") WITH ORDINALITY AS t(a, i)
    WHERE a IS NOT NULL GROUP BY a ORDER BY min(i)
  ), '{}');
  NEW."component_ids" := COALESCE(ARRAY(SELECT DISTINCT c FROM unnest(NEW."component_ids") AS c WHERE c IS NOT NULL), '{}');

  -- No auth context (service_role / server-side jobs) bypasses the checks below.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  actor_interested := COALESCE(actor_id = NEW."owner_id", false) OR actor_id = ANY (NEW."assignee_ids");

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'closed' THEN
      RAISE EXCEPTION 'A new ticket can''t start out closed';
    END IF;
    NEW."created_by" := actor_id;
    NEW."created_at" := now();
    NEW."close_reason" := NULL;
    NEW."closed_at" := NULL;
    NEW."closed_by" := NULL;
    IF NEW."bounty" IS NOT NULL THEN
      IF NOT actor_is_lead THEN
        RAISE EXCEPTION 'Only leads and admins set bounties';
      END IF;
      IF actor_interested THEN
        RAISE EXCEPTION 'You can''t set the bounty on a ticket you own or are assigned to';
      END IF;
      NEW."bounty_set_by" := actor_id;
    ELSE
      NEW."bounty_set_by" := NULL;
    END IF;
    NEW."updated_at" := now();
    RETURN NEW;
  END IF;

  NEW."id" := OLD."id";
  NEW."number" := OLD."number";
  NEW."created_by" := OLD."created_by";
  NEW."created_at" := OLD."created_at";

  IF OLD."status" = 'closed' AND NEW."status" = 'closed' THEN
    unmoved := NEW;
    unmoved."milestone_id" := OLD."milestone_id";
    IF unmoved IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Reopen the ticket to change it';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'closed' AND NEW."status" = 'closed' THEN
    -- Closing.
    IF NOT actor_is_lead THEN
      RAISE EXCEPTION 'Only leads and admins close tickets';
    END IF;
    IF NEW."close_reason" IS NULL THEN
      RAISE EXCEPTION 'Say why the ticket is being closed';
    END IF;
    NEW."closed_at" := now();
    NEW."closed_by" := actor_id;
  ELSIF OLD."status" = 'closed' AND NEW."status" <> 'closed' THEN
    -- Reopening. Any points it paid out are taken back (see
    -- workshop_ticket_points), and paid again when it's next completed.
    IF NOT actor_is_lead THEN
      RAISE EXCEPTION 'Only leads and admins reopen tickets';
    END IF;
    NEW."close_reason" := NULL;
    NEW."closed_at" := NULL;
    NEW."closed_by" := NULL;
  ELSE
    NEW."close_reason" := NULL;
    NEW."closed_at" := NULL;
    NEW."closed_by" := NULL;
  END IF;

  -- The bounty.
  IF NEW."bounty" IS DISTINCT FROM OLD."bounty" THEN
    IF NOT actor_is_lead THEN
      RAISE EXCEPTION 'Only leads and admins set bounties';
    END IF;
    IF actor_interested THEN
      RAISE EXCEPTION 'You can''t set the bounty on a ticket you own or are assigned to';
    END IF;
    NEW."bounty_set_by" := CASE WHEN NEW."bounty" IS NULL THEN NULL ELSE actor_id END;
  ELSE
    NEW."bounty_set_by" := OLD."bounty_set_by";
  END IF;
  -- Whoever set the bounty has since become the owner or an assignee: it has
  -- to be set again by someone with no stake in the ticket.
  IF NEW."bounty_set_by" IS NOT NULL AND (NEW."bounty_set_by" = NEW."owner_id" OR NEW."bounty_set_by" = ANY (NEW."assignee_ids")) THEN
    NEW."bounty" := NULL;
    NEW."bounty_set_by" := NULL;
  END IF;

  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enforce_workshop_ticket" BEFORE INSERT OR UPDATE ON public."WorkshopTicket"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_workshop_ticket();

-- ---------------------------------------------------------------------------
-- Shop sessions and their plans
-- ---------------------------------------------------------------------------

-- A repeating schedule ("Tuesdays and Thursdays, 6 to 9pm"). Its sessions are
-- ordinary rows in WorkshopSession, created by the app when the series is,
-- so each one can be moved or cancelled on its own like a calendar event.
CREATE TABLE IF NOT EXISTS public."WorkshopSessionSeries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    -- 0 = Sunday ... 6 = Saturday.
    "weekdays" smallint[] NOT NULL CHECK (cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]),
    -- Local wall-clock times, "HH:MM".
    "start_time" text NOT NULL CHECK ("start_time" ~ '^\d{2}:\d{2}$'),
    "end_time" text NOT NULL CHECK ("end_time" ~ '^\d{2}:\d{2}$'),
    "starts_on" date NOT NULL,
    "ends_on" date NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "WorkshopSessionSeries_range_check" CHECK ("ends_on" >= "starts_on")
);

CREATE TABLE IF NOT EXISTS public."WorkshopSession" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "series_id" uuid REFERENCES public."WorkshopSessionSeries"("id") ON DELETE SET NULL,
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "notes" text NOT NULL DEFAULT '',
    -- Whether the plan has been started from the previous session's
    -- unfinished tickets (see workshop_seed_session_plan).
    "plan_seeded" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "WorkshopSession_time_check" CHECK ("ends_at" > "starts_at")
);

CREATE INDEX IF NOT EXISTS "workshop_session_starts_at_idx" ON public."WorkshopSession" ("starts_at");
CREATE INDEX IF NOT EXISTS "workshop_session_series_idx" ON public."WorkshopSession" ("series_id");

-- The tickets planned for a session.
CREATE TABLE IF NOT EXISTS public."WorkshopSessionTicket" (
    "session_id" uuid NOT NULL REFERENCES public."WorkshopSession"("id") ON DELETE CASCADE,
    "ticket_id" uuid NOT NULL REFERENCES public."WorkshopTicket"("id") ON DELETE CASCADE,
    "sort_order" double precision NOT NULL DEFAULT 0,
    -- Brought over from the previous session rather than added by hand.
    "carried_over" boolean NOT NULL DEFAULT false,
    "added_at" timestamp with time zone NOT NULL DEFAULT now(),
    "added_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL,
    PRIMARY KEY ("session_id", "ticket_id")
);

CREATE INDEX IF NOT EXISTS "workshop_session_ticket_ticket_idx" ON public."WorkshopSessionTicket" ("ticket_id");

-- Start a session's plan from the previous session's: every ticket planned
-- for the last session before it that isn't closed yet. Happens once per
-- session, the first time anyone looks at it (so members see their carried-
-- over tickets without waiting for a lead), and again whenever a lead asks
-- (p_force) to pull in anything added to the previous session since. Returns
-- how many tickets were added.
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

  SELECT s."id" INTO previous_id FROM public."WorkshopSession" s
    WHERE s."starts_at" < this_session."starts_at"
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

REVOKE ALL ON FUNCTION public.workshop_seed_session_plan(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workshop_seed_session_plan(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.workshop_seed_session_plan(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_seed_session_plan(uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- GreyPoints
-- ---------------------------------------------------------------------------

-- Every point anyone has earned, one row per award. A balance is the sum of a
-- person's awards less what they've spent on rewards.
CREATE TABLE IF NOT EXISTS public."WorkshopPointAward" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES public."User"("user_id") ON DELETE CASCADE,
    "points" integer NOT NULL CHECK ("points" <> 0),
    -- ticket: a completed ticket's bounty (paid out by the database).
    -- recognition: a team recognition, at a fixed value per level.
    -- attendance: hours in shop (reserved for the attendance link).
    -- adjustment: an admin's correction, with a note saying why.
    "kind" text NOT NULL CHECK ("kind" IN ('ticket', 'recognition', 'attendance', 'adjustment')),
    "ticket_id" uuid REFERENCES public."WorkshopTicket"("id") ON DELETE CASCADE,
    "recognition_level" text CHECK ("recognition_level" IN ('shoutout', 'recognition', 'mvp')),
    "note" text NOT NULL DEFAULT '',
    "awarded_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "awarded_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "WorkshopPointAward_source_check" CHECK (
        ("kind" = 'ticket') = ("ticket_id" IS NOT NULL)
        AND ("kind" = 'recognition') = ("recognition_level" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "workshop_point_award_user_idx" ON public."WorkshopPointAward" ("user_id");
CREATE INDEX IF NOT EXISTS "workshop_point_award_ticket_idx" ON public."WorkshopPointAward" ("ticket_id");

-- What each level of team recognition is worth.
CREATE OR REPLACE FUNCTION "public"."workshop_recognition_points"("level" text) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE level WHEN 'shoutout' THEN 10 WHEN 'recognition' THEN 25 WHEN 'mvp' THEN 50 END;
$$;

-- Awards made by hand: leads and admins give recognitions (to someone else,
-- at the level's value), and admins make adjustments (with a reason). Ticket
-- awards only come from closing a ticket.
CREATE OR REPLACE FUNCTION "public"."enforce_workshop_point_award"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.workshop_role();
BEGIN
  -- No auth context (service_role), or paying out a ticket from inside
  -- workshop_ticket_points (a trigger, so one level deeper than a direct
  -- insert): no checks.
  IF actor_id IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  NEW."awarded_by" := actor_id;
  NEW."awarded_at" := now();
  IF NEW."kind" = 'recognition' THEN
    IF actor_role NOT IN ('lead', 'admin') THEN
      RAISE EXCEPTION 'Only leads and admins give recognitions';
    END IF;
    IF NEW."user_id" = actor_id THEN
      RAISE EXCEPTION 'You can''t recognize yourself';
    END IF;
    NEW."points" := public.workshop_recognition_points(NEW."recognition_level");
  ELSIF NEW."kind" = 'adjustment' THEN
    IF actor_role <> 'admin' THEN
      RAISE EXCEPTION 'Only admins adjust points';
    END IF;
    IF btrim(NEW."note") = '' THEN
      RAISE EXCEPTION 'Say why the points are being adjusted';
    END IF;
  ELSE
    RAISE EXCEPTION 'Those points can''t be added by hand';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enforce_workshop_point_award" BEFORE INSERT ON public."WorkshopPointAward"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_workshop_point_award();

-- How a bounty is split. The assignees share it equally (any remainder goes
-- one point each to the first assignees). An owner who isn't an assignee
-- takes 10% (at least 1 point) off the top; with no assignees, the owner gets
-- all of it.
CREATE OR REPLACE FUNCTION "public"."workshop_bounty_split"("bounty" integer, "owner_id" uuid, "assignee_ids" uuid[])
    RETURNS TABLE ("user_id" uuid, "points" integer)
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  n integer := cardinality(assignee_ids);
  owner_share integer := 0;
  rest integer;
BEGIN
  IF bounty IS NULL OR bounty <= 0 THEN
    RETURN;
  END IF;
  IF n = 0 THEN
    IF owner_id IS NOT NULL THEN
      user_id := owner_id;
      points := bounty;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;
  IF owner_id IS NOT NULL AND NOT (owner_id = ANY (assignee_ids)) THEN
    owner_share := GREATEST(1, bounty / 10);
    user_id := owner_id;
    points := owner_share;
    RETURN NEXT;
  END IF;
  rest := bounty - owner_share;
  FOR i IN 1..n LOOP
    user_id := assignee_ids[i];
    points := rest / n + CASE WHEN i <= rest % n THEN 1 ELSE 0 END;
    IF points > 0 THEN
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- Pays a ticket's bounty when it's closed as complete, and takes it back if
-- the ticket is reopened.
CREATE OR REPLACE FUNCTION "public"."workshop_ticket_points"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD."status" = 'closed' AND NEW."status" <> 'closed' THEN
    DELETE FROM public."WorkshopPointAward" WHERE "ticket_id" = NEW."id";
  ELSIF OLD."status" <> 'closed' AND NEW."status" = 'closed' AND NEW."close_reason" = 'complete' AND NEW."bounty" IS NOT NULL THEN
    INSERT INTO public."WorkshopPointAward" ("user_id", "points", "kind", "ticket_id", "note", "awarded_by")
      SELECT s."user_id", s."points", 'ticket', NEW."id", format('#%s %s', NEW."number", NEW."title"), NEW."closed_by"
      FROM public.workshop_bounty_split(NEW."bounty", NEW."owner_id", NEW."assignee_ids") s;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "workshop_ticket_points" AFTER UPDATE OF "status" ON public."WorkshopTicket"
    FOR EACH ROW EXECUTE FUNCTION public.workshop_ticket_points();

-- The rewards marketplace.
CREATE TABLE IF NOT EXISTS public."WorkshopReward" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    "description" text NOT NULL DEFAULT '',
    "cost" integer NOT NULL CHECK ("cost" > 0),
    -- How many can be redeemed in all; null for no limit.
    "stock" integer CHECK ("stock" >= 0),
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL
);

-- A person cashing points in for a reward. Requested ones wait for a lead to
-- hand the reward over (fulfilled); a cancelled one gives the points back.
CREATE TABLE IF NOT EXISTS public."WorkshopRedemption" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reward_id" uuid REFERENCES public."WorkshopReward"("id") ON DELETE SET NULL,
    "user_id" uuid NOT NULL REFERENCES public."User"("user_id") ON DELETE CASCADE,
    -- As they were when it was redeemed.
    "reward_name" text NOT NULL,
    "cost" integer NOT NULL CHECK ("cost" > 0),
    "status" text NOT NULL DEFAULT 'requested' CHECK ("status" IN ('requested', 'fulfilled', 'cancelled')),
    "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
    "resolved_at" timestamp with time zone,
    "resolved_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "workshop_redemption_user_idx" ON public."WorkshopRedemption" ("user_id");

-- Everyone's points: earned all time, earned this season (calendar year),
-- spent on rewards, and what's left to spend.
CREATE OR REPLACE VIEW public."WorkshopPointBalance" WITH (security_invoker = true) AS
  SELECT
    u."user_id",
    u."name",
    COALESCE(a."earned", 0)::integer AS "earned",
    COALESCE(a."season_earned", 0)::integer AS "season_earned",
    COALESCE(r."spent", 0)::integer AS "spent",
    (COALESCE(a."earned", 0) - COALESCE(r."spent", 0))::integer AS "balance"
  FROM public."User" u
  LEFT JOIN (
    SELECT "user_id",
      sum("points") AS "earned",
      sum("points") FILTER (WHERE date_trunc('year', "awarded_at") = date_trunc('year', now())) AS "season_earned"
    FROM public."WorkshopPointAward" GROUP BY "user_id"
  ) a ON a."user_id" = u."user_id"
  LEFT JOIN (
    SELECT "user_id", sum("cost") AS "spent" FROM public."WorkshopRedemption" WHERE "status" <> 'cancelled' GROUP BY "user_id"
  ) r ON r."user_id" = u."user_id"
  WHERE u."workshop_role" IN ('observer', 'member', 'lead', 'admin') OR a."earned" IS NOT NULL;

-- Redeem a reward for the signed-in person, if they have the points and it's
-- in stock. Done here so two redemptions at once can't overspend.
CREATE OR REPLACE FUNCTION "public"."workshop_redeem_reward"("p_reward_id" uuid) RETURNS public."WorkshopRedemption"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  reward public."WorkshopReward";
  available integer;
  redeemed integer;
  result public."WorkshopRedemption";
BEGIN
  IF actor_id IS NULL OR public.workshop_role() NOT IN ('member', 'lead', 'admin') THEN
    RAISE EXCEPTION 'Workshop members redeem rewards' USING ERRCODE = '42501';
  END IF;

  -- One redemption at a time per person, and per reward.
  PERFORM 1 FROM public."User" WHERE "user_id" = actor_id FOR UPDATE;
  SELECT * INTO reward FROM public."WorkshopReward" WHERE "id" = p_reward_id FOR UPDATE;
  IF NOT FOUND OR NOT reward."active" THEN
    RAISE EXCEPTION 'That reward isn''t available';
  END IF;

  IF reward."stock" IS NOT NULL THEN
    SELECT count(*) INTO redeemed FROM public."WorkshopRedemption" WHERE "reward_id" = reward."id" AND "status" <> 'cancelled';
    IF redeemed >= reward."stock" THEN
      RAISE EXCEPTION 'That reward is out of stock';
    END IF;
  END IF;

  SELECT
    COALESCE((SELECT sum("points") FROM public."WorkshopPointAward" WHERE "user_id" = actor_id), 0)
    - COALESCE((SELECT sum("cost") FROM public."WorkshopRedemption" WHERE "user_id" = actor_id AND "status" <> 'cancelled'), 0)
  INTO available;
  IF available < reward."cost" THEN
    RAISE EXCEPTION 'You need % more points for that', reward."cost" - available;
  END IF;

  INSERT INTO public."WorkshopRedemption" ("reward_id", "user_id", "reward_name", "cost")
    VALUES (reward."id", actor_id, reward."name", reward."cost")
    RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_redeem_reward(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workshop_redeem_reward(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workshop_redeem_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_redeem_reward(uuid) TO service_role;

-- Resolving a redemption: leads and admins mark a requested one fulfilled or
-- cancel it, and the person who asked can cancel their own while it's still
-- requested. Nothing else about it changes.
CREATE OR REPLACE FUNCTION "public"."enforce_workshop_redemption_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'requested' THEN
    RAISE EXCEPTION 'That redemption has already been resolved';
  END IF;
  IF NEW."status" = 'requested' THEN
    RETURN OLD;
  END IF;
  IF public.workshop_role() NOT IN ('lead', 'admin') AND NOT (actor_id = OLD."user_id" AND NEW."status" = 'cancelled') THEN
    RAISE EXCEPTION 'Only leads and admins hand out rewards';
  END IF;
  NEW."id" := OLD."id";
  NEW."reward_id" := OLD."reward_id";
  NEW."user_id" := OLD."user_id";
  NEW."reward_name" := OLD."reward_name";
  NEW."cost" := OLD."cost";
  NEW."requested_at" := OLD."requested_at";
  NEW."resolved_at" := now();
  NEW."resolved_by" := actor_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enforce_workshop_redemption_update" BEFORE UPDATE ON public."WorkshopRedemption"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_workshop_redemption_update();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

ALTER TABLE public."WorkshopComponent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopMilestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopSessionSeries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopSessionTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopPointAward" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopReward" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopRedemption" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."WorkshopComponent" TO authenticated, service_role;
GRANT ALL ON public."WorkshopMilestone" TO authenticated, service_role;
GRANT ALL ON public."WorkshopTicket" TO authenticated, service_role;
GRANT ALL ON public."WorkshopSessionSeries" TO authenticated, service_role;
GRANT ALL ON public."WorkshopSession" TO authenticated, service_role;
GRANT ALL ON public."WorkshopSessionTicket" TO authenticated, service_role;
GRANT ALL ON public."WorkshopPointAward" TO authenticated, service_role;
GRANT ALL ON public."WorkshopReward" TO authenticated, service_role;
GRANT ALL ON public."WorkshopRedemption" TO authenticated, service_role;
GRANT SELECT ON public."WorkshopPointBalance" TO authenticated, service_role;

-- Everyone in Workshop (observers included) can see everything.
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopComponent" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopMilestone" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopTicket" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopSessionSeries" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopSession" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopSessionTicket" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopPointAward" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopReward" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopRedemption" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));

-- Tickets: members and above open and edit them (the trigger decides who
-- closes them and sets bounties). Nobody deletes one; it's closed instead.
CREATE POLICY "Enable insert for members" ON public."WorkshopTicket" FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'));
CREATE POLICY "Enable update for members" ON public."WorkshopTicket" FOR UPDATE TO authenticated
    USING ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'))
    WITH CHECK ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'));

-- Leads and admins run the rest: components, milestones, the schedule and
-- session plans, and the rewards on offer.
CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopComponent" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopComponent" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));

CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopMilestone" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopMilestone" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopMilestone" FOR DELETE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin'));

CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopSessionSeries" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopSessionSeries" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopSessionSeries" FOR DELETE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin'));

CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopSession" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopSession" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopSession" FOR DELETE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin'));

CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopSessionTicket" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopSessionTicket" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopSessionTicket" FOR DELETE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin'));

CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopReward" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopReward" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));

-- Points: leads and admins add recognitions and admins adjustments (the
-- trigger checks which); admins can remove a hand-made award given by
-- mistake. Ticket awards come and go with the ticket.
CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopPointAward" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete of hand-made awards for admins" ON public."WorkshopPointAward" FOR DELETE TO authenticated
    USING ((SELECT public.workshop_role()) = 'admin' AND "kind" IN ('recognition', 'adjustment'));

-- Redemptions are made through workshop_redeem_reward(); leads resolve them,
-- and people can cancel their own (the trigger checks which).
CREATE POLICY "Enable update for leads, admins, and the redeemer" ON public."WorkshopRedemption" FOR UPDATE TO authenticated
    USING ((SELECT public.workshop_role()) IN ('lead', 'admin') OR ("user_id" = auth.uid() AND (SELECT public.has_app_access('workshop'))))
    WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin') OR ("user_id" = auth.uid() AND (SELECT public.has_app_access('workshop'))));
