-- Preflight event timeline (issue #79): milestones are schedule items of a
-- third kind, so they share the calendar, its category filters, and sync.
-- 'phase' groups them on the timeline (event preparation, competition day,
-- elimination tournament, event closeout).

ALTER TABLE public."PreflightScheduleItem" DROP CONSTRAINT "PreflightScheduleItem_kind_check";
ALTER TABLE public."PreflightScheduleItem" ADD CONSTRAINT "PreflightScheduleItem_kind_check"
    CHECK ("kind" IN ('match', 'custom', 'milestone'));

ALTER TABLE public."PreflightScheduleItem" ADD COLUMN IF NOT EXISTS "phase" text;
ALTER TABLE public."PreflightScheduleItem" ADD CONSTRAINT "PreflightScheduleItem_phase_check"
    CHECK ("phase" IS NULL OR "phase" IN ('prep', 'competition', 'elimination', 'closeout'));
