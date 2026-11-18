-- Workshop: checklists. A checklist template is a list of steps the team
-- keeps (members and above write and edit them). Leads and admins add a copy
-- of one to a shop session, with an owner; its steps start out assigned to
-- the owner, who can hand any of them to someone else.
--
-- * Steps are done in any order. A step is ticked off by its assignee, the
--   checklist's owner, or an admin, and who did it and when is kept.
-- * Once every step is done, the owner or an admin signs the checklist off.
--   A signed-off checklist can't be changed until the sign-off is undone (by
--   the owner or an admin).
-- * A checklist is a copy: editing the template later doesn't change
--   checklists already added to sessions.
--
-- Templates and checklists are written through the functions below (so a
-- template's steps are saved all at once, and a checklist always starts as a
-- full copy); the triggers decide who may change what afterwards.

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."WorkshopChecklistTemplate" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    "description" text NOT NULL DEFAULT '',
    -- Archived rather than deleted; archived ones can't be added to sessions.
    "archived" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public."WorkshopChecklistTemplateStep" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "template_id" uuid NOT NULL REFERENCES public."WorkshopChecklistTemplate"("id") ON DELETE CASCADE,
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    "details" text NOT NULL DEFAULT '',
    "sort_order" double precision NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "workshop_checklist_template_step_template_idx" ON public."WorkshopChecklistTemplateStep" ("template_id", "sort_order");

-- ---------------------------------------------------------------------------
-- Checklists on shop sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."WorkshopChecklist" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The template it was copied from (kept for reference only).
    "template_id" uuid REFERENCES public."WorkshopChecklistTemplate"("id") ON DELETE SET NULL,
    "session_id" uuid NOT NULL REFERENCES public."WorkshopSession"("id") ON DELETE CASCADE,
    -- As the template was when it was added.
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    "description" text NOT NULL DEFAULT '',
    -- Responsible for the checklist; signs it off. Always set when added.
    "owner_id" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "sort_order" double precision NOT NULL DEFAULT 0,
    "signed_off_at" timestamp with time zone,
    "signed_off_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "workshop_checklist_session_idx" ON public."WorkshopChecklist" ("session_id", "sort_order");
CREATE INDEX IF NOT EXISTS "workshop_checklist_owner_idx" ON public."WorkshopChecklist" ("owner_id");

CREATE TABLE IF NOT EXISTS public."WorkshopChecklistStep" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "checklist_id" uuid NOT NULL REFERENCES public."WorkshopChecklist"("id") ON DELETE CASCADE,
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    "details" text NOT NULL DEFAULT '',
    "sort_order" double precision NOT NULL DEFAULT 0,
    -- Starts as the checklist's owner.
    "assignee_id" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    -- Who ticked it off, and when.
    "completed_at" timestamp with time zone,
    "completed_by" uuid REFERENCES public."User"("user_id") ON DELETE SET NULL,
    CONSTRAINT "WorkshopChecklistStep_completed_check" CHECK ("completed_at" IS NOT NULL OR "completed_by" IS NULL)
);

CREATE INDEX IF NOT EXISTS "workshop_checklist_step_checklist_idx" ON public."WorkshopChecklistStep" ("checklist_id", "sort_order");
CREATE INDEX IF NOT EXISTS "workshop_checklist_step_assignee_idx" ON public."WorkshopChecklistStep" ("assignee_id") WHERE "completed_at" IS NULL;

-- Whether someone can own a checklist or be given one of its steps: a member
-- or above in Workshop (observers can't tick anything off).
CREATE OR REPLACE FUNCTION public.workshop_can_do_checklists("p_user_id" uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."User" u
    WHERE u."user_id" = p_user_id AND NOT u."deactivated" AND u."workshop_role" IN ('member', 'lead', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Writing templates
-- ---------------------------------------------------------------------------

-- Create a template (p_id null) or replace an existing one's name,
-- description, and steps. p_steps is a JSON array of {"title", "details"}, in
-- order. Returns the template's id.
CREATE OR REPLACE FUNCTION public.workshop_save_checklist_template("p_id" uuid, "p_name" text, "p_description" text, "p_steps" jsonb)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  saved_id uuid := p_id;
BEGIN
  IF public.workshop_role() NOT IN ('member', 'lead', 'admin') THEN
    RAISE EXCEPTION 'Workshop members write checklists' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Give the checklist a name';
  END IF;
  IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps) = 0 THEN
    RAISE EXCEPTION 'A checklist needs at least one step';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_steps) s WHERE btrim(COALESCE(s->>'title', '')) = '') THEN
    RAISE EXCEPTION 'Every step needs a title';
  END IF;

  IF saved_id IS NULL THEN
    INSERT INTO public."WorkshopChecklistTemplate" ("name", "description", "created_by", "updated_by")
      VALUES (btrim(p_name), COALESCE(p_description, ''), auth.uid(), auth.uid())
      RETURNING "id" INTO saved_id;
  ELSE
    UPDATE public."WorkshopChecklistTemplate"
      SET "name" = btrim(p_name), "description" = COALESCE(p_description, ''), "updated_at" = now(), "updated_by" = auth.uid()
      WHERE "id" = saved_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No such checklist';
    END IF;
    DELETE FROM public."WorkshopChecklistTemplateStep" WHERE "template_id" = saved_id;
  END IF;

  INSERT INTO public."WorkshopChecklistTemplateStep" ("template_id", "title", "details", "sort_order")
    SELECT saved_id, btrim(s.value->>'title'), COALESCE(s.value->>'details', ''), s.ordinality
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS s(value, ordinality);
  RETURN saved_id;
END;
$$;

-- Members and above archive and restore templates directly (and save them
-- through workshop_save_checklist_template). Either way, who made a template
-- stays, and who changed it last is recorded.
CREATE OR REPLACE FUNCTION public.enforce_workshop_checklist_template() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  NEW."id" := OLD."id";
  NEW."created_at" := OLD."created_at";
  NEW."created_by" := OLD."created_by";
  NEW."updated_at" := now();
  NEW."updated_by" := auth.uid();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Adding checklists to sessions
-- ---------------------------------------------------------------------------

-- Add a copy of a template to a session, owned by p_owner_id, with every
-- step assigned to the owner. Leads and admins. Returns the checklist's id.
CREATE OR REPLACE FUNCTION public.workshop_add_checklist("p_session_id" uuid, "p_template_id" uuid, "p_owner_id" uuid)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  template public."WorkshopChecklistTemplate";
  checklist_id uuid;
  next_order double precision;
BEGIN
  IF public.workshop_role() NOT IN ('lead', 'admin') THEN
    RAISE EXCEPTION 'Only leads and admins add checklists to sessions' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."WorkshopSession" WHERE "id" = p_session_id) THEN
    RAISE EXCEPTION 'No such session';
  END IF;
  SELECT * INTO template FROM public."WorkshopChecklistTemplate" WHERE "id" = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such checklist';
  END IF;
  IF template."archived" THEN
    RAISE EXCEPTION 'That checklist is archived';
  END IF;
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Pick an owner for the checklist';
  END IF;
  IF NOT public.workshop_can_do_checklists(p_owner_id) THEN
    RAISE EXCEPTION 'The owner has to be a Workshop member';
  END IF;

  SELECT COALESCE(max("sort_order"), 0) + 1 INTO next_order FROM public."WorkshopChecklist" WHERE "session_id" = p_session_id;
  INSERT INTO public."WorkshopChecklist" ("template_id", "session_id", "name", "description", "owner_id", "sort_order", "created_by")
    VALUES (template."id", p_session_id, template."name", template."description", p_owner_id, next_order, auth.uid())
    RETURNING "id" INTO checklist_id;
  INSERT INTO public."WorkshopChecklistStep" ("checklist_id", "title", "details", "sort_order", "assignee_id")
    SELECT checklist_id, s."title", s."details", s."sort_order", p_owner_id
    FROM public."WorkshopChecklistTemplateStep" s WHERE s."template_id" = template."id";
  RETURN checklist_id;
END;
$$;

-- Who may change a checklist on a session:
-- * Leads and admins change its owner (to another member). Steps that were
--   assigned to the old owner go to the new one.
-- * The owner or an admin signs it off once every step is done, or undoes
--   the sign-off.
-- * Nothing else about it changes, and a signed-off checklist doesn't change
--   at all until the sign-off is undone.
CREATE OR REPLACE FUNCTION public.enforce_workshop_checklist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.workshop_role();
  actor_runs_it boolean;
BEGIN
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;
  actor_runs_it := actor_role = 'admin' OR actor_id = OLD."owner_id";

  NEW."id" := OLD."id";
  NEW."template_id" := OLD."template_id";
  NEW."session_id" := OLD."session_id";
  NEW."name" := OLD."name";
  NEW."description" := OLD."description";
  NEW."created_at" := OLD."created_at";
  NEW."created_by" := OLD."created_by";

  IF OLD."signed_off_at" IS NOT NULL AND NEW."signed_off_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Undo the sign-off to change this checklist';
  END IF;

  IF OLD."signed_off_at" IS NOT NULL AND NEW."signed_off_at" IS NULL THEN
    -- Undoing the sign-off, and nothing else at the same time.
    IF NOT actor_runs_it THEN
      RAISE EXCEPTION 'Only the checklist''s owner or an admin undoes its sign-off';
    END IF;
    NEW."owner_id" := OLD."owner_id";
    NEW."sort_order" := OLD."sort_order";
    NEW."signed_off_by" := NULL;
    RETURN NEW;
  END IF;

  IF NEW."owner_id" IS DISTINCT FROM OLD."owner_id" THEN
    IF actor_role NOT IN ('lead', 'admin') THEN
      RAISE EXCEPTION 'Only leads and admins change a checklist''s owner';
    END IF;
    IF NEW."owner_id" IS NULL OR NOT public.workshop_can_do_checklists(NEW."owner_id") THEN
      RAISE EXCEPTION 'The owner has to be a Workshop member';
    END IF;
  END IF;

  IF NEW."sort_order" IS DISTINCT FROM OLD."sort_order" AND actor_role NOT IN ('lead', 'admin') THEN
    RAISE EXCEPTION 'Only leads and admins reorder a session''s checklists';
  END IF;

  IF NEW."signed_off_at" IS NOT NULL THEN
    -- Signing off, by whoever owned it before this change.
    IF NOT actor_runs_it THEN
      RAISE EXCEPTION 'Only the checklist''s owner or an admin signs it off';
    END IF;
    IF NEW."owner_id" IS DISTINCT FROM OLD."owner_id" THEN
      RAISE EXCEPTION 'Change the owner and sign off separately';
    END IF;
    IF EXISTS (SELECT 1 FROM public."WorkshopChecklistStep" WHERE "checklist_id" = OLD."id" AND "completed_at" IS NULL) THEN
      RAISE EXCEPTION 'Every step has to be done before the checklist is signed off';
    END IF;
    NEW."signed_off_at" := now();
    NEW."signed_off_by" := actor_id;
  ELSE
    NEW."signed_off_by" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.workshop_checklist_owner_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- The new owner takes over the steps the old owner had (done ones keep who
  -- did them).
  UPDATE public."WorkshopChecklistStep" SET "assignee_id" = NEW."owner_id"
    WHERE "checklist_id" = NEW."id" AND "assignee_id" IS NOT DISTINCT FROM OLD."owner_id" AND "completed_at" IS NULL;
  RETURN NULL;
END;
$$;

-- Who may change a step:
-- * The checklist's owner or an admin assigns it to a member.
-- * Its assignee, the checklist's owner, or an admin ticks it off (who and
--   when are recorded here, not by the client) or unticks it.
-- * Nothing else about a step changes, and nothing changes once the
--   checklist is signed off.
CREATE OR REPLACE FUNCTION public.enforce_workshop_checklist_step() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor_id uuid := auth.uid();
  checklist public."WorkshopChecklist";
  actor_runs_it boolean;
BEGIN
  -- No auth context, or the owner-change trigger moving steps to a new owner.
  IF actor_id IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO checklist FROM public."WorkshopChecklist" WHERE "id" = OLD."checklist_id";
  IF checklist."signed_off_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Undo the checklist''s sign-off to change it';
  END IF;
  actor_runs_it := public.workshop_role() = 'admin' OR actor_id = checklist."owner_id";

  NEW."id" := OLD."id";
  NEW."checklist_id" := OLD."checklist_id";
  NEW."title" := OLD."title";
  NEW."details" := OLD."details";
  NEW."sort_order" := OLD."sort_order";

  IF NEW."assignee_id" IS DISTINCT FROM OLD."assignee_id" THEN
    IF NOT actor_runs_it THEN
      RAISE EXCEPTION 'Only the checklist''s owner or an admin assigns its steps';
    END IF;
    IF NEW."assignee_id" IS NULL OR NOT public.workshop_can_do_checklists(NEW."assignee_id") THEN
      RAISE EXCEPTION 'Steps go to Workshop members';
    END IF;
  END IF;

  IF (NEW."completed_at" IS NULL) <> (OLD."completed_at" IS NULL) THEN
    IF NOT (actor_runs_it OR actor_id = OLD."assignee_id") THEN
      RAISE EXCEPTION 'Only the step''s assignee, the checklist''s owner, or an admin ticks it off';
    END IF;
    IF NEW."completed_at" IS NOT NULL THEN
      NEW."completed_at" := now();
      NEW."completed_by" := actor_id;
    ELSE
      NEW."completed_by" := NULL;
    END IF;
  ELSE
    NEW."completed_at" := OLD."completed_at";
    NEW."completed_by" := OLD."completed_by";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enforce_workshop_checklist_template" BEFORE UPDATE ON public."WorkshopChecklistTemplate"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_workshop_checklist_template();
CREATE TRIGGER "enforce_workshop_checklist" BEFORE UPDATE ON public."WorkshopChecklist"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_workshop_checklist();
CREATE TRIGGER "workshop_checklist_owner_changed" AFTER UPDATE OF "owner_id" ON public."WorkshopChecklist"
    FOR EACH ROW WHEN (NEW."owner_id" IS DISTINCT FROM OLD."owner_id")
    EXECUTE FUNCTION public.workshop_checklist_owner_changed();
CREATE TRIGGER "enforce_workshop_checklist_step" BEFORE UPDATE ON public."WorkshopChecklistStep"
    FOR EACH ROW EXECUTE FUNCTION public.enforce_workshop_checklist_step();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.workshop_can_do_checklists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workshop_can_do_checklists(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.workshop_save_checklist_template(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workshop_save_checklist_template(uuid, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.workshop_save_checklist_template(uuid, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.workshop_add_checklist(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workshop_add_checklist(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workshop_add_checklist(uuid, uuid, uuid) TO authenticated, service_role;

ALTER TABLE public."WorkshopChecklistTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopChecklistTemplateStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopChecklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkshopChecklistStep" ENABLE ROW LEVEL SECURITY;

-- People read everything and change only what the policies below allow; the
-- rest is written by the functions above.
GRANT SELECT, UPDATE ON public."WorkshopChecklistTemplate" TO authenticated;
GRANT SELECT ON public."WorkshopChecklistTemplateStep" TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public."WorkshopChecklist" TO authenticated;
GRANT SELECT, UPDATE ON public."WorkshopChecklistStep" TO authenticated;
GRANT ALL ON public."WorkshopChecklistTemplate" TO service_role;
GRANT ALL ON public."WorkshopChecklistTemplateStep" TO service_role;
GRANT ALL ON public."WorkshopChecklist" TO service_role;
GRANT ALL ON public."WorkshopChecklistStep" TO service_role;

CREATE POLICY "Enable read access for Workshop" ON public."WorkshopChecklistTemplate" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopChecklistTemplateStep" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopChecklist" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopChecklistStep" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));

-- Templates: members and above archive and restore them.
CREATE POLICY "Enable update for members" ON public."WorkshopChecklistTemplate" FOR UPDATE TO authenticated
    USING ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'))
    WITH CHECK ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'));

-- Checklists and their steps: members and above (the triggers decide who
-- changes what). Leads and admins take a checklist off a session, unless it's
-- signed off.
CREATE POLICY "Enable update for members" ON public."WorkshopChecklist" FOR UPDATE TO authenticated
    USING ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'))
    WITH CHECK ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopChecklist" FOR DELETE TO authenticated
    USING ((SELECT public.workshop_role()) IN ('lead', 'admin') AND "signed_off_at" IS NULL);
CREATE POLICY "Enable update for members" ON public."WorkshopChecklistStep" FOR UPDATE TO authenticated
    USING ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'))
    WITH CHECK ((SELECT public.workshop_role()) IN ('member', 'lead', 'admin'));
