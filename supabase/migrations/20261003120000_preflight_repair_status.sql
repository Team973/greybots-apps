-- Preflight: "Repair in progress" robot status. From any checklist the pit
-- can switch to repair, then resume that checklist (same run_id and
-- checklist_index) or jump to the pre-match checklist.
ALTER TABLE public."PreflightRobotStatusLog" DROP CONSTRAINT "PreflightRobotStatusLog_status_check";
ALTER TABLE public."PreflightRobotStatusLog" ADD CONSTRAINT "PreflightRobotStatusLog_status_check"
    CHECK ("status" IN ('inbound', 'pending', 'repair', 'ready', 'away'));
