-- Only leads and admins may change the team pick list. "Enable write access
-- for picklists" let any approved user write any PickList row, including the
-- official team list (only the app hid those controls).
--
-- The personal-list policy is narrowed to personal rows as well: it only
-- checked user_id, so a member could still have created a team row by
-- setting themselves as its owner. Team rows have no user_id.

DROP POLICY IF EXISTS "Enable write access for picklists" ON public."PickList";
DROP POLICY IF EXISTS "Enable write access for personal lists" ON public."PickList";

CREATE POLICY "Enable write access for personal lists" ON public."PickList" TO authenticated
    USING ("type" = 'personal' AND user_id = auth.uid())
    WITH CHECK ("type" = 'personal' AND user_id = auth.uid());

CREATE POLICY "Enable write access to team lists for leads and admins" ON public."PickList" TO authenticated
    USING ("type" = 'team' AND EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')))
    WITH CHECK ("type" = 'team' AND EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
