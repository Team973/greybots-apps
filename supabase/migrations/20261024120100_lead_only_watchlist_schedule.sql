-- Only leads and admins may change the watchlist and the scout schedule. The
-- app already hid those controls from everyone else, but the policies let any
-- approved user write directly. Reads are unchanged, and the restrictive
-- "Require scouting access" policies still apply on top.

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."Watchlist";
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public."Watchlist";

CREATE POLICY "Enable insert for leads and admins" ON public."Watchlist" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable delete for leads and admins" ON public."Watchlist" FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."ScoutAssignment";
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public."ScoutAssignment";
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public."ScoutAssignment";

CREATE POLICY "Enable insert for leads and admins" ON public."ScoutAssignment" FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable update for leads and admins" ON public."ScoutAssignment" FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
CREATE POLICY "Enable delete for leads and admins" ON public."ScoutAssignment" FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public."User" u WHERE u.user_id = auth.uid() AND u.role IN ('lead', 'admin')));
