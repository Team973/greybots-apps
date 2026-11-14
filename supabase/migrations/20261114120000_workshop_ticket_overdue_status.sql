-- Workshop: "Overdue" as a ticket stage, set by hand from In progress (the
-- app offers To do -> In progress or Closed; In progress -> To do, Overdue or
-- Closed; Overdue -> To do or Closed). Everything that cares about a ticket's
-- stage only asks whether it's closed (who can close or reopen it, and
-- carrying unfinished tickets into the next session's plan), so an overdue
-- ticket counts as open everywhere. This only widens the allowed values, so
-- every existing row still passes.

ALTER TABLE public."WorkshopTicket" DROP CONSTRAINT IF EXISTS "WorkshopTicket_status_check";
ALTER TABLE public."WorkshopTicket"
    ADD CONSTRAINT "WorkshopTicket_status_check" CHECK ("status" IN ('open', 'in_progress', 'overdue', 'closed'));
