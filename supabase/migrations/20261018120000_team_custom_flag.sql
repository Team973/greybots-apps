-- Teams that drop out of an event are now removed from "Team" when the event
-- is refreshed from The Blue Alliance (issue #127). A team added by hand,
-- which TBA doesn't list for the event, is marked custom so a refresh keeps
-- it. Every existing row came from TBA.
ALTER TABLE public."Team"
    ADD COLUMN IF NOT EXISTS "custom" boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public."Team"."custom" IS 'Added by hand rather than from TBA: kept when the event''s team list is refreshed.';

-- Leads and admins add and remove custom teams from the app (the Event Teams
-- page). Rows that came from TBA are still only written by the tba-proxy
-- function and the nightly job, which use the service role.
CREATE POLICY "Enable insert of custom teams for leads and admins" ON public."Team" FOR INSERT TO authenticated
    WITH CHECK ("custom" AND EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable delete of custom teams for leads and admins" ON public."Team" FOR DELETE TO authenticated
    USING ("custom" AND EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
