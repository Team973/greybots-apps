-- Preflight tasks can be assigned to a pit member (free text, so it works for
-- kiosk crew and web accounts alike), e.g. repair tasks handed out during
-- "Repair in progress".
ALTER TABLE public."PreflightTask" ADD COLUMN IF NOT EXISTS "assignee" text;
