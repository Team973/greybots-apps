-- Preflight schedule: add 'practice' and 'programming' event types.
ALTER TABLE public."PreflightScheduleItem" DROP CONSTRAINT "PreflightScheduleItem_category_check";
ALTER TABLE public."PreflightScheduleItem" ADD CONSTRAINT "PreflightScheduleItem_category_check"
    CHECK ("category" IN ('event', 'match', 'pit', 'admin', 'practice', 'programming'));
