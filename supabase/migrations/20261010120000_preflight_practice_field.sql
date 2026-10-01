-- Preflight practice field (issue #82): a side trip in the pit flow. Once the
-- post-match checklists are clear, the pit can run a practice field checklist
-- and take the robot to the practice field, then come back to pre-match.

-- 'practice' = the robot is at the practice field.
ALTER TABLE public."PreflightRobotStatusLog" DROP CONSTRAINT "PreflightRobotStatusLog_status_check";
ALTER TABLE public."PreflightRobotStatusLog" ADD CONSTRAINT "PreflightRobotStatusLog_status_check"
    CHECK ("status" IN ('inbound', 'pending', 'repair', 'ready', 'away', 'practice'));

-- For a 'pending' entry that isn't part of the standard sequence (so has no
-- checklist_index): which checklist is being run. 'practice' today.
ALTER TABLE public."PreflightRobotStatusLog" ADD COLUMN IF NOT EXISTS "checklist_id" text;
