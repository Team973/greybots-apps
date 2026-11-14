-- Workshop: a ticket's history through its stages (To do, In progress,
-- Overdue, Closed), shown at the bottom of the ticket page.
--
-- A trigger records every change of stage, whoever makes it and from wherever,
-- so the history can't be skipped. Nobody writes the table directly (no
-- insert, update or delete policies); everyone in Workshop reads it.
--
-- Tickets that already exist get what's known: when they were opened, their
-- current stage if it's In progress or Overdue (as of their last update), and
-- when they were closed. Those rows are marked `backfilled`, since the steps
-- in between weren't kept.

CREATE TABLE IF NOT EXISTS public."WorkshopTicketStageChange" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ticket_id" uuid NOT NULL REFERENCES public."WorkshopTicket"("id") ON DELETE CASCADE,
    -- Null for the ticket being opened (and for backfilled rows).
    "from_status" text,
    "to_status" text NOT NULL,
    -- Why, when it was closed.
    "close_reason" text,
    "changed_at" timestamp with time zone NOT NULL DEFAULT now(),
    "changed_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "backfilled" boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS "workshop_ticket_stage_change_ticket_idx" ON public."WorkshopTicketStageChange" ("ticket_id", "changed_at");

CREATE OR REPLACE FUNCTION public.workshop_ticket_stage_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO public."WorkshopTicketStageChange" ("ticket_id", "from_status", "to_status", "close_reason", "changed_by")
    VALUES (
      NEW."id",
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."status" END,
      NEW."status",
      CASE WHEN NEW."status" = 'closed' THEN NEW."close_reason" END,
      -- Only someone with a profile (never fails a ticket save over it).
      (SELECT u."user_id" FROM public."User" u WHERE u."user_id" = auth.uid())
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "workshop_ticket_stage_history" ON public."WorkshopTicket";
CREATE TRIGGER "workshop_ticket_stage_history" AFTER INSERT OR UPDATE OF "status" ON public."WorkshopTicket"
    FOR EACH ROW EXECUTE FUNCTION public.workshop_ticket_stage_history();

-- What's known about the tickets that already exist (once; skipped for any
-- ticket that already has history).
INSERT INTO public."WorkshopTicketStageChange" ("ticket_id", "from_status", "to_status", "close_reason", "changed_at", "changed_by", "backfilled")
SELECT t."id", NULL, 'open', NULL, t."created_at", t."created_by", true
FROM public."WorkshopTicket" t
WHERE NOT EXISTS (SELECT 1 FROM public."WorkshopTicketStageChange" h WHERE h."ticket_id" = t."id");

INSERT INTO public."WorkshopTicketStageChange" ("ticket_id", "from_status", "to_status", "close_reason", "changed_at", "changed_by", "backfilled")
SELECT t."id", NULL, t."status", NULL, t."updated_at", NULL, true
FROM public."WorkshopTicket" t
WHERE t."status" IN ('in_progress', 'overdue')
  AND NOT EXISTS (SELECT 1 FROM public."WorkshopTicketStageChange" h WHERE h."ticket_id" = t."id" AND NOT h."backfilled")
  AND NOT EXISTS (SELECT 1 FROM public."WorkshopTicketStageChange" h WHERE h."ticket_id" = t."id" AND h."to_status" = t."status");

INSERT INTO public."WorkshopTicketStageChange" ("ticket_id", "from_status", "to_status", "close_reason", "changed_at", "changed_by", "backfilled")
SELECT t."id", NULL, 'closed', t."close_reason", t."closed_at", t."closed_by", true
FROM public."WorkshopTicket" t
WHERE t."status" = 'closed' AND t."closed_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public."WorkshopTicketStageChange" h WHERE h."ticket_id" = t."id" AND NOT h."backfilled")
  AND NOT EXISTS (SELECT 1 FROM public."WorkshopTicketStageChange" h WHERE h."ticket_id" = t."id" AND h."to_status" = 'closed');

ALTER TABLE public."WorkshopTicketStageChange" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."WorkshopTicketStageChange" TO authenticated;
GRANT ALL ON public."WorkshopTicketStageChange" TO service_role;
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopTicketStageChange" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
