-- Workshop: remove GreyPoints (ticket bounties, recognitions, and the rewards
-- marketplace). Everything 20261019120000_workshop_app.sql added for it goes:
-- the points ledger, rewards and redemptions, the balance view, the functions
-- and triggers that paid points out and spent them, and the ticket's bounty
-- columns. The ticket trigger keeps its other rules (who closes and reopens a
-- ticket, and a closed ticket can't be edited) without the bounty checks.

DROP TRIGGER IF EXISTS "workshop_ticket_points" ON public."WorkshopTicket";
DROP FUNCTION IF EXISTS public.workshop_ticket_points();

DROP VIEW IF EXISTS public."WorkshopPointBalance";
DROP FUNCTION IF EXISTS public.workshop_redeem_reward(uuid);

-- Their triggers and policies go with them.
DROP TABLE IF EXISTS public."WorkshopRedemption";
DROP TABLE IF EXISTS public."WorkshopReward";
DROP TABLE IF EXISTS public."WorkshopPointAward";

DROP FUNCTION IF EXISTS public.enforce_workshop_redemption_update();
DROP FUNCTION IF EXISTS public.enforce_workshop_point_award();
DROP FUNCTION IF EXISTS public.workshop_recognition_points(text);
DROP FUNCTION IF EXISTS public.workshop_bounty_split(integer, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.workshop_bounty_options();

-- Who's allowed to do what to a ticket.
-- * Members and above open and edit tickets; observers can't (RLS).
-- * Only leads and admins close or reopen one, and a closed ticket can't be
--   edited until it's reopened (except to move it to another milestone, which
--   is also what deleting its milestone does).
CREATE OR REPLACE FUNCTION "public"."enforce_workshop_ticket"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_is_lead boolean := public.workshop_role() IN ('lead', 'admin');
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

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'closed' THEN
      RAISE EXCEPTION 'A new ticket can''t start out closed';
    END IF;
    NEW."created_by" := actor_id;
    NEW."created_at" := now();
    NEW."close_reason" := NULL;
    NEW."closed_at" := NULL;
    NEW."closed_by" := NULL;
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
    -- Reopening.
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

  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

ALTER TABLE public."WorkshopTicket" DROP CONSTRAINT IF EXISTS "WorkshopTicket_bounty_set_by_check";
ALTER TABLE public."WorkshopTicket" DROP COLUMN IF EXISTS "bounty";
ALTER TABLE public."WorkshopTicket" DROP COLUMN IF EXISTS "bounty_set_by";
