-- Preflight: observers (accounts not yet made members) may see the pit
-- display and nothing else. The display reads from a device's local copy of
-- these tables, so observers need to be able to pull them. Writes stay
-- limited to members (or leads/admins) as before, and tasks and notes, which
-- the display doesn't show, stay members-only.

DROP POLICY "Enable read access for members" ON public."PreflightSetting";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightSetting" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightScheduleItem";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightScheduleItem" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightRobotStatusLog";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightRobotStatusLog" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightChecklistCheck";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightChecklistCheck" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightChecklistRun";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightChecklistRun" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightRepair";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightRepair" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightBattery";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightBattery" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightBatteryMeasurement";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightBatteryMeasurement" FOR SELECT TO authenticated USING (true);

DROP POLICY "Enable read access for members" ON public."PreflightBatteryUse";
CREATE POLICY "Enable read access for logged in users" ON public."PreflightBatteryUse" FOR SELECT TO authenticated USING (true);
