-- Diagnostics: its own role, and its library in the cloud (issue #148).
-- Saved views, report templates, pipelines and robot mappings are made on
-- one computer and shared with the team through this table.
--
-- * A fourth per-app role, "diagnostics_role", managed from the same People
--   page as the others.
-- * Everyone in Diagnostics can read the library; members and above add to
--   it and change it; only leads and admins delete from it.

-- ---------------------------------------------------------------------------
-- The Diagnostics role
-- ---------------------------------------------------------------------------

-- Everyone starts with the role they have in Preflight: both are pit tools,
-- used by the same people. A deactivated account stays deactivated, and gets
-- its Preflight role back here too when it's restored. (Migrations run with
-- no auth context, so the role trigger lets this update through.)
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "diagnostics_role" text NOT NULL DEFAULT 'pending';
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "prior_diagnostics_role" text;
UPDATE public."User" SET "diagnostics_role" = "preflight_role", "prior_diagnostics_role" = "prior_preflight_role";
ALTER TABLE public."User" ADD CONSTRAINT "User_diagnostics_role_check"
    CHECK ("diagnostics_role" IN ('admin', 'lead', 'member', 'observer', 'pending', 'deactivated'));

ALTER TABLE public."User" DROP CONSTRAINT "User_deactivated_check";
ALTER TABLE public."User" ADD CONSTRAINT "User_deactivated_check" CHECK (
    ("deactivated" AND "role" = 'deactivated' AND "preflight_role" = 'deactivated' AND "workshop_role" = 'deactivated' AND "diagnostics_role" = 'deactivated')
    OR (NOT "deactivated" AND "role" <> 'deactivated' AND "preflight_role" <> 'deactivated' AND "workshop_role" <> 'deactivated' AND "diagnostics_role" <> 'deactivated')
);

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
  NEW."workshop_role" := 'pending';
  NEW."diagnostics_role" := 'pending';
  NEW."deactivated" := false;
  NEW."prior_role" := NULL;
  NEW."prior_preflight_role" := NULL;
  NEW."prior_workshop_role" := NULL;
  NEW."prior_diagnostics_role" := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_user_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  actor_preflight_role text;
  actor_workshop_role text;
  actor_diagnostics_role text;
  actor_is_admin boolean;
BEGIN
  -- No auth context (service_role / server-side jobs) bypasses the checks below.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "role", "preflight_role", "workshop_role", "diagnostics_role"
    INTO actor_role, actor_preflight_role, actor_workshop_role, actor_diagnostics_role
    FROM "public"."User" WHERE "user_id" = actor_id;
  -- An admin of any app can deactivate, restore, and rename people.
  actor_is_admin := actor_role = 'admin' OR actor_preflight_role = 'admin' OR actor_workshop_role = 'admin'
    OR actor_diagnostics_role = 'admin';

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
      IF OLD."role" = 'admin' OR OLD."preflight_role" = 'admin' OR OLD."workshop_role" = 'admin' OR OLD."diagnostics_role" = 'admin' THEN
        RAISE EXCEPTION 'Admins cannot be deactivated';
      END IF;
      NEW."prior_role" := OLD."role";
      NEW."prior_preflight_role" := OLD."preflight_role";
      NEW."prior_workshop_role" := OLD."workshop_role";
      NEW."prior_diagnostics_role" := OLD."diagnostics_role";
      NEW."role" := 'deactivated';
      NEW."preflight_role" := 'deactivated';
      NEW."workshop_role" := 'deactivated';
      NEW."diagnostics_role" := 'deactivated';
    ELSE
      NEW."role" := COALESCE(OLD."prior_role", 'pending');
      NEW."preflight_role" := COALESCE(OLD."prior_preflight_role", 'pending');
      NEW."workshop_role" := COALESCE(OLD."prior_workshop_role", 'pending');
      NEW."diagnostics_role" := COALESCE(OLD."prior_diagnostics_role", 'pending');
      NEW."prior_role" := NULL;
      NEW."prior_preflight_role" := NULL;
      NEW."prior_workshop_role" := NULL;
      NEW."prior_diagnostics_role" := NULL;
    END IF;
    NEW."name" := OLD."name";
    RETURN NEW;
  END IF;

  NEW."prior_role" := OLD."prior_role";
  NEW."prior_preflight_role" := OLD."prior_preflight_role";
  NEW."prior_workshop_role" := OLD."prior_workshop_role";
  NEW."prior_diagnostics_role" := OLD."prior_diagnostics_role";

  -- Roles are per app: a person's role in each app is changed by someone with
  -- enough authority in that same app.
  PERFORM "public"."check_app_role_change"('scouting', actor_role, OLD."role", NEW."role");
  PERFORM "public"."check_app_role_change"('Preflight', actor_preflight_role, OLD."preflight_role", NEW."preflight_role");
  PERFORM "public"."check_app_role_change"('Workshop', actor_workshop_role, OLD."workshop_role", NEW."workshop_role");
  PERFORM "public"."check_app_role_change"('Diagnostics', actor_diagnostics_role, OLD."diagnostics_role", NEW."diagnostics_role");

  IF NEW."name" IS DISTINCT FROM OLD."name" AND actor_id IS DISTINCT FROM NEW."user_id" AND NOT COALESCE(actor_is_admin, false) THEN
    RAISE EXCEPTION 'Only admins may change another user''s name';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."has_app_access"("app" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Whether the signed-in account has been given a role in the app
  -- ('scouting', 'preflight', 'workshop' or 'diagnostics'), or in any app
  -- ('any'). Pending and deactivated accounts have none.
  SELECT EXISTS (
    SELECT 1 FROM "public"."User" u
    WHERE u."user_id" = auth.uid()
      AND NOT u."deactivated"
      AND (
        (app IN ('scouting', 'any') AND u."role" IN ('observer', 'member', 'lead', 'admin'))
        OR (app IN ('preflight', 'any') AND u."preflight_role" IN ('observer', 'member', 'lead', 'admin'))
        OR (app IN ('workshop', 'any') AND u."workshop_role" IN ('observer', 'member', 'lead', 'admin'))
        OR (app IN ('diagnostics', 'any') AND u."diagnostics_role" IN ('observer', 'member', 'lead', 'admin'))
      )
  );
$$;

-- The signed-in account's Diagnostics role ('pending' when there's none),
-- for the policies below.
CREATE OR REPLACE FUNCTION "public"."diagnostics_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT u."diagnostics_role" FROM "public"."User" u WHERE u."user_id" = auth.uid() AND NOT u."deactivated"),
    'pending'
  );
$$;

REVOKE ALL ON FUNCTION public.diagnostics_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diagnostics_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnostics_role() TO service_role;

-- ---------------------------------------------------------------------------
-- The library
-- ---------------------------------------------------------------------------

-- One row per item, the item itself kept whole in "body" as the app keeps
-- it on disk (apps/diagnostics/src/shared/library.ts). The app checks every
-- body it receives, so a bad one can't break it; the columns beside it are
-- for listing and for knowing what's changed.
CREATE TABLE IF NOT EXISTS public."DiagnosticsLibraryItem" (
    "id" uuid PRIMARY KEY,
    "kind" text NOT NULL CHECK ("kind" IN ('view', 'template', 'pipeline', 'mapping')),
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    -- Saved for one robot's data only ("frc254"), or null for any.
    "robot" text,
    "body" jsonb NOT NULL CHECK (jsonb_typeof("body") = 'object'),
    -- When the item was last changed, on whichever computer it was changed.
    "changed_at" timestamp with time zone NOT NULL,
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "updated_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "diagnostics_library_kind_idx" ON public."DiagnosticsLibraryItem" ("kind");

-- Who made a row and when stay as they were; who last changed it is
-- whoever's signed in.
CREATE OR REPLACE FUNCTION "public"."enforce_diagnostics_library_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW."created_by" := auth.uid();
    END IF;
    NEW."created_at" := now();
  ELSE
    NEW."id" := OLD."id";
    NEW."created_by" := OLD."created_by";
    NEW."created_at" := OLD."created_at";
  END IF;
  IF auth.uid() IS NOT NULL THEN
    NEW."updated_by" := auth.uid();
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enforce_diagnostics_library_item" BEFORE INSERT OR UPDATE ON public."DiagnosticsLibraryItem"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_diagnostics_library_item();

ALTER TABLE public."DiagnosticsLibraryItem" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."DiagnosticsLibraryItem" TO authenticated, service_role;

-- Everyone in Diagnostics (observers included) can see the library;
-- members and above add to it and change it; leads and admins delete.
CREATE POLICY "Enable read access for Diagnostics" ON public."DiagnosticsLibraryItem" FOR SELECT TO authenticated
    USING ((SELECT public.has_app_access('diagnostics')));
CREATE POLICY "Enable insert for members" ON public."DiagnosticsLibraryItem" FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.diagnostics_role()) IN ('member', 'lead', 'admin'));
CREATE POLICY "Enable update for members" ON public."DiagnosticsLibraryItem" FOR UPDATE TO authenticated
    USING ((SELECT public.diagnostics_role()) IN ('member', 'lead', 'admin'))
    WITH CHECK ((SELECT public.diagnostics_role()) IN ('member', 'lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."DiagnosticsLibraryItem" FOR DELETE TO authenticated
    USING ((SELECT public.diagnostics_role()) IN ('lead', 'admin'));
