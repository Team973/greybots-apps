-- Per-app roles. A person's role is now set separately for each app: "role"
-- stays the scouting (GreyScout) role, and "preflight_role" is their role in
-- Preflight. Someone can be a scouting lead and only an observer in the pit.
-- Both are managed from the same People table in either app.

-- Everyone keeps the Preflight access they have today, which until now came
-- from the scouting role. (Migrations run with no auth context, so the role
-- trigger lets this update through.)
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "preflight_role" text NOT NULL DEFAULT 'observer';
UPDATE public."User" SET "preflight_role" = "role";
ALTER TABLE public."User" ADD CONSTRAINT "User_preflight_role_check"
    CHECK ("preflight_role" IN ('admin', 'lead', 'member', 'observer'));

-- New accounts start as observers in both apps.
DROP POLICY "Enable insert for own profile" ON public."User";
CREATE POLICY "Enable insert for own profile" ON public."User" FOR INSERT TO authenticated
    WITH CHECK ("user_id" = auth.uid() AND "role" = 'observer' AND "preflight_role" = 'observer');

-- The promotion / relegation rules, unchanged, as a function of one app's
-- roles so they can be applied to each app separately.
CREATE OR REPLACE FUNCTION "public"."check_app_role_change"("app" "text", "actor_role" "text", "old_role" "text", "new_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  role_rank jsonb := '{"observer":0,"member":1,"lead":2,"admin":3}'::jsonb;
  actor_rank int := (role_rank ->> actor_role)::int;
  old_rank int := (role_rank ->> old_role)::int;
  new_rank int := (role_rank ->> new_role)::int;
BEGIN
  IF new_role IS NOT DISTINCT FROM old_role THEN
    RETURN;
  END IF;

  IF actor_rank IS NULL THEN
    RAISE EXCEPTION 'Only recognized roles may change roles';
  END IF;

  IF new_rank > old_rank THEN
    -- Promotion: the actor must outrank the target's current role, and cannot grant
    -- a role higher than their own.
    IF NOT (actor_rank > old_rank AND new_rank <= actor_rank) THEN
      RAISE EXCEPTION 'Not authorized to promote this user to % for %', new_role, app;
    END IF;
  ELSIF new_rank < old_rank THEN
    -- Relegation (demotion) is admin-only.
    IF actor_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only % admins may relegate users', app;
    END IF;
  END IF;
END;
$$;

-- A person's role in each app is changed by someone with enough authority in
-- that same app.
CREATE OR REPLACE FUNCTION "public"."enforce_user_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  actor_preflight_role text;
BEGIN
  -- No auth context (service_role / server-side jobs) bypasses the checks below.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "role", "preflight_role" INTO actor_role, actor_preflight_role FROM "public"."User" WHERE "user_id" = actor_id;

  -- Roles are per app: a person's role in each app is changed by someone with
  -- enough authority in that same app.
  PERFORM "public"."check_app_role_change"('scouting', actor_role, OLD."role", NEW."role");
  PERFORM "public"."check_app_role_change"('Preflight', actor_preflight_role, OLD."preflight_role", NEW."preflight_role");

  IF NEW."name" IS DISTINCT FROM OLD."name" AND actor_id IS DISTINCT FROM NEW."user_id" THEN
    RAISE EXCEPTION 'Users may only update their own name';
  END IF;

  RETURN NEW;
END;
$$;

-- Preflight's policies check the Preflight role instead of the scouting one.
DROP POLICY "Enable insert for leads and admins" ON "public"."PreflightSetting";
CREATE POLICY "Enable insert for leads and admins" ON "public"."PreflightSetting" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for leads and admins" ON "public"."PreflightSetting";
CREATE POLICY "Enable update for leads and admins" ON "public"."PreflightSetting" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for leads and admins" ON "public"."PreflightScheduleItem";
CREATE POLICY "Enable insert for leads and admins" ON "public"."PreflightScheduleItem" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for leads and admins" ON "public"."PreflightScheduleItem";
CREATE POLICY "Enable update for leads and admins" ON "public"."PreflightScheduleItem" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable read access for members" ON "public"."PreflightTask";
CREATE POLICY "Enable read access for members" ON "public"."PreflightTask" FOR SELECT TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightTask";
CREATE POLICY "Enable insert for members" ON "public"."PreflightTask" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightTask";
CREATE POLICY "Enable update for members" ON "public"."PreflightTask" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightRobotStatusLog";
CREATE POLICY "Enable insert for members" ON "public"."PreflightRobotStatusLog" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightRobotStatusLog";
CREATE POLICY "Enable update for members" ON "public"."PreflightRobotStatusLog" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightChecklistCheck";
CREATE POLICY "Enable insert for members" ON "public"."PreflightChecklistCheck" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightChecklistCheck";
CREATE POLICY "Enable update for members" ON "public"."PreflightChecklistCheck" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightChecklistRun";
CREATE POLICY "Enable insert for members" ON "public"."PreflightChecklistRun" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightChecklistRun";
CREATE POLICY "Enable update for members" ON "public"."PreflightChecklistRun" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable read access for members" ON "public"."PreflightNote";
CREATE POLICY "Enable read access for members" ON "public"."PreflightNote" FOR SELECT TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightNote";
CREATE POLICY "Enable insert for members" ON "public"."PreflightNote" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightNote";
CREATE POLICY "Enable update for members" ON "public"."PreflightNote" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightRepair";
CREATE POLICY "Enable insert for members" ON "public"."PreflightRepair" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightRepair";
CREATE POLICY "Enable update for members" ON "public"."PreflightRepair" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightBattery";
CREATE POLICY "Enable insert for members" ON "public"."PreflightBattery" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightBattery";
CREATE POLICY "Enable update for members" ON "public"."PreflightBattery" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightBatteryMeasurement";
CREATE POLICY "Enable insert for members" ON "public"."PreflightBatteryMeasurement" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightBatteryMeasurement";
CREATE POLICY "Enable update for members" ON "public"."PreflightBatteryMeasurement" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable insert for members" ON "public"."PreflightBatteryUse";
CREATE POLICY "Enable insert for members" ON "public"."PreflightBatteryUse" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));

DROP POLICY "Enable update for members" ON "public"."PreflightBatteryUse";
CREATE POLICY "Enable update for members" ON "public"."PreflightBatteryUse" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));
