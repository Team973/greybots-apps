-- Preflight: ending and starting the day, and taking a break.
--   'day_ended' = the pit has closed for the day (reached by finishing the
--                 end of day checklist). Nothing is timed until "Start day".
--   'break'     = the pit has paused (lunch, a team meeting) while the robot
--                 isn't ready. Ending the break returns to the state before it.
-- The end of day and start of day checklists run as 'pending' entries with
-- checklist_id 'end_of_day' / 'start_of_day', like the practice field one.
ALTER TABLE public."PreflightRobotStatusLog" DROP CONSTRAINT "PreflightRobotStatusLog_status_check";
ALTER TABLE public."PreflightRobotStatusLog" ADD CONSTRAINT "PreflightRobotStatusLog_status_check"
    CHECK ("status" IN ('inbound', 'pending', 'repair', 'ready', 'away', 'practice', 'break', 'day_ended'));
