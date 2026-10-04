-- Accounts must be approved before they can use any app, and can be
-- deactivated (issue #112).
--
-- * A new account starts with the role "pending" in every app. A lead or
--   admin gives it a role, app by app; until then it can read nothing.
-- * An admin (of any app) can deactivate a non-admin account, which takes away
--   its roles everywhere, and restore it, which puts them back.
-- * An admin (of any app) can change anyone's name.
--
-- Existing accounts keep the roles they have (observers stay observers).

ALTER TABLE public."User" DROP CONSTRAINT "User_role_check";
ALTER TABLE public."User" DROP CONSTRAINT "User_preflight_role_check";
ALTER TABLE public."User" ADD CONSTRAINT "User_role_check" CHECK ("role" IN ('admin', 'lead', 'member', 'observer', 'pending', 'deactivated'));
ALTER TABLE public."User" ADD CONSTRAINT "User_preflight_role_check" CHECK ("preflight_role" IN ('admin', 'lead', 'member', 'observer', 'pending', 'deactivated'));
ALTER TABLE public."User" ALTER COLUMN "role" SET DEFAULT 'pending';
ALTER TABLE public."User" ALTER COLUMN "preflight_role" SET DEFAULT 'pending';

-- Deactivated accounts keep their row. Their roles in each app become
-- "deactivated" (so every existing role check turns them away), and the
-- roles they had are kept here for when they're restored.
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "deactivated" boolean NOT NULL DEFAULT false;
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "prior_role" text;
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "prior_preflight_role" text;
ALTER TABLE public."User" ADD CONSTRAINT "User_deactivated_check" CHECK (
    ("deactivated" AND "role" = 'deactivated' AND "preflight_role" = 'deactivated')
    OR (NOT "deactivated" AND "role" <> 'deactivated' AND "preflight_role" <> 'deactivated')
);

-- New accounts are always pending, whatever the client sends (so an app
-- build from before this change still registers people correctly).
CREATE OR REPLACE FUNCTION "public"."enforce_user_profile_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- No auth context (service_role / server-side jobs) may create any row.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- A new account always starts pending in every app, whatever the client
  -- sent: a lead or admin has to give it a role before it can see anything.
  NEW."role" := 'pending';
  NEW."preflight_role" := 'pending';
  NEW."deactivated" := false;
  NEW."prior_role" := NULL;
  NEW."prior_preflight_role" := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enforce_user_profile_insert" BEFORE INSERT ON public."User"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_user_profile_insert();

DROP POLICY "Enable insert for own profile" ON public."User";
CREATE POLICY "Enable insert for own profile" ON public."User" FOR INSERT TO authenticated
    WITH CHECK ("user_id" = auth.uid());

-- The promotion / relegation rules for one app's roles. New: only leads and
-- admins approve a pending account, and "deactivated" isn't a role to assign.
CREATE OR REPLACE FUNCTION "public"."check_app_role_change"("app" "text", "actor_role" "text", "old_role" "text", "new_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  role_rank jsonb := '{"deactivated":-2,"pending":-1,"observer":0,"member":1,"lead":2,"admin":3}'::jsonb;
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

  -- "deactivated" is set and cleared by deactivating or restoring the account,
  -- never as an ordinary role change.
  IF new_role = 'deactivated' OR old_role = 'deactivated' THEN
    RAISE EXCEPTION 'Deactivate or restore the account instead of changing its role';
  END IF;

  IF new_rank > old_rank THEN
    -- Promotion: the actor must outrank the target's current role, and cannot grant
    -- a role higher than their own.
    IF NOT (actor_rank > old_rank AND new_rank <= actor_rank) THEN
      RAISE EXCEPTION 'Not authorized to promote this user to % for %', new_role, app;
    END IF;
    -- Approving a pending account (giving it its first role) takes a lead or admin.
    IF old_role = 'pending' AND actor_rank < 2 THEN
      RAISE EXCEPTION 'Only % leads and admins may approve a pending user', app;
    END IF;
  ELSIF new_rank < old_rank THEN
    -- Relegation (demotion) is admin-only.
    IF actor_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only % admins may relegate users', app;
    END IF;
  END IF;
END;
$$;

-- Role changes, deactivating / restoring, and renaming.
CREATE OR REPLACE FUNCTION "public"."enforce_user_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  actor_preflight_role text;
  actor_is_admin boolean;
BEGIN
  -- No auth context (service_role / server-side jobs) bypasses the checks below.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "role", "preflight_role" INTO actor_role, actor_preflight_role FROM "public"."User" WHERE "user_id" = actor_id;
  -- An admin of any app can deactivate, restore, and rename people.
  actor_is_admin := actor_role = 'admin' OR actor_preflight_role = 'admin';

  -- The account a row belongs to, when it was created, and the roles saved at
  -- deactivation are never edited directly.
  NEW."user_id" := OLD."user_id";
  NEW."created_at" := OLD."created_at";

  -- Deactivating or restoring an account. Deactivating takes away the roles
  -- in every app (so every role check denies access) and remembers them;
  -- restoring puts them back.
  IF NEW."deactivated" IS DISTINCT FROM OLD."deactivated" THEN
    IF NOT COALESCE(actor_is_admin, false) THEN
      RAISE EXCEPTION 'Only admins may deactivate or restore users';
    END IF;
    IF NEW."deactivated" THEN
      IF OLD."user_id" = actor_id THEN
        RAISE EXCEPTION 'You cannot deactivate your own account';
      END IF;
      IF OLD."role" = 'admin' OR OLD."preflight_role" = 'admin' THEN
        RAISE EXCEPTION 'Admins cannot be deactivated';
      END IF;
      NEW."prior_role" := OLD."role";
      NEW."prior_preflight_role" := OLD."preflight_role";
      NEW."role" := 'deactivated';
      NEW."preflight_role" := 'deactivated';
    ELSE
      NEW."role" := COALESCE(OLD."prior_role", 'pending');
      NEW."preflight_role" := COALESCE(OLD."prior_preflight_role", 'pending');
      NEW."prior_role" := NULL;
      NEW."prior_preflight_role" := NULL;
    END IF;
    NEW."name" := OLD."name";
    RETURN NEW;
  END IF;

  NEW."prior_role" := OLD."prior_role";
  NEW."prior_preflight_role" := OLD."prior_preflight_role";

  -- Roles are per app: a person's role in each app is changed by someone with
  -- enough authority in that same app.
  PERFORM "public"."check_app_role_change"('scouting', actor_role, OLD."role", NEW."role");
  PERFORM "public"."check_app_role_change"('Preflight', actor_preflight_role, OLD."preflight_role", NEW."preflight_role");

  IF NEW."name" IS DISTINCT FROM OLD."name" AND actor_id IS DISTINCT FROM NEW."user_id" AND NOT COALESCE(actor_is_admin, false) THEN
    RAISE EXCEPTION 'Only admins may change another user''s name';
  END IF;

  RETURN NEW;
END;
$$;

-- Whether the signed-in account has a role in an app.
CREATE OR REPLACE FUNCTION "public"."has_app_access"("app" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Whether the signed-in account has been given a role in the app
  -- ('scouting' or 'preflight'), or in any app ('any'). Pending and
  -- deactivated accounts have none.
  SELECT EXISTS (
    SELECT 1 FROM "public"."User" u
    WHERE u."user_id" = auth.uid()
      AND NOT u."deactivated"
      AND (
        (app IN ('scouting', 'any') AND u."role" IN ('observer', 'member', 'lead', 'admin'))
        OR (app IN ('preflight', 'any') AND u."preflight_role" IN ('observer', 'member', 'lead', 'admin'))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_app_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_app_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_access(text) TO service_role;

-- Until now most tables were readable (and many writable) by anyone signed
-- in. These restrictive policies sit on top of the existing ones: whatever
-- those allow, the account must also have been given a role.
-- * Scouting tables: reading needs a role in any app (Preflight reads match
--   data); writing needs a scouting role.
-- * Preflight tables: a Preflight role.
-- * User: without a role, an account sees only its own profile.
CREATE POLICY "Require an approved account to read" ON "public"."AutoPath" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."AutoPath" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."AutoPath" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."AutoPath" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."StrategyBoard" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."StrategyBoard" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."StrategyBoard" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."StrategyBoard" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."MatchData" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."MatchData" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."MatchData" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."MatchData" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."PitData" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."PitData" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."PitData" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."PitData" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."PreScoutData" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."PreScoutData" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."PreScoutData" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."PreScoutData" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."PreScoutComment" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."PreScoutComment" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."PreScoutComment" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."PreScoutComment" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."PickList" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."PickList" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."PickList" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."PickList" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."Event" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."Event" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."Event" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."Event" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."MatchData2025" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."MatchData2025" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."MatchData2025" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."MatchData2025" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."Match" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."Match" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."Match" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."Match" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."MatchDataUploaded2025" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."MatchDataUploaded2025" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."MatchDataUploaded2025" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."MatchDataUploaded2025" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."RobotPhoto" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."RobotPhoto" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."RobotPhoto" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."RobotPhoto" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."Team" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."Team" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."Team" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."Team" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."Watchlist" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."Watchlist" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."Watchlist" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."Watchlist" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."Playoffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."Playoffs" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."Playoffs" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."Playoffs" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require an approved account to read" ON "public"."ScoutAssignment" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((SELECT public.has_app_access('any')));
CREATE POLICY "Require scouting access to insert" ON "public"."ScoutAssignment" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to update" ON "public"."ScoutAssignment" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require scouting access to delete" ON "public"."ScoutAssignment" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((SELECT public.has_app_access('scouting')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightSetting" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightScheduleItem" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightTask" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightRobotStatusLog" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightChecklistCheck" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightChecklistRun" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightNote" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightRepair" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightBattery" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightBatteryMeasurement" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightBatteryUse" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require Preflight access" ON "public"."PreflightTimer" AS RESTRICTIVE TO "authenticated" USING ((SELECT public.has_app_access('preflight'))) WITH CHECK ((SELECT public.has_app_access('preflight')));
CREATE POLICY "Require an approved account to read other profiles" ON "public"."User" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("user_id" = auth.uid() OR ((SELECT public.has_app_access('any')))));
