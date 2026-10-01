


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





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


ALTER FUNCTION "public"."check_app_role_change"("app" "text", "actor_role" "text", "old_role" "text", "new_role" "text") OWNER TO "postgres";


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


ALTER FUNCTION "public"."enforce_user_profile_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preflight_sync_row"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Drop an incoming update that's older than the stored row.
  IF TG_OP = 'UPDATE' AND NEW.updated_at < OLD.updated_at THEN
    RETURN NULL;
  END IF;
  -- clock_timestamp(), not now(), so rows in one transaction still get
  -- distinct, increasing cursor values.
  NEW.synced_at := clock_timestamp();
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."preflight_sync_row"() OWNER TO "postgres";


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."Event" (
    "event_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date",
    "end_date" "date"
);


ALTER TABLE "public"."Event" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."MatchData" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text",
    "scouted_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "prematch_match_number" smallint NOT NULL,
    "prematch_team_number" smallint NOT NULL,
    "prematch_alliance" "text",
    "prematch_noshow" boolean DEFAULT false,
    "postmatch_cards" "text",
    "postmatch_died" boolean DEFAULT false NOT NULL,
    "postmatch_comments" "text",
    "key" "text",
    "source" "text",
    "postmatch_broke" boolean DEFAULT false NOT NULL,
    "postmatch_beached" boolean DEFAULT false NOT NULL,
    "auto_failed" boolean DEFAULT false NOT NULL,
    "postmatch_played_defense" boolean DEFAULT false NOT NULL,
    "postmatch_defense_impact" "text",
    CONSTRAINT "MatchData_defense_impact_check" CHECK (("postmatch_defense_impact" IS NULL) OR ("postmatch_defense_impact" = ANY (ARRAY['none'::"text", 'good'::"text", 'minimal'::"text", 'ineffective'::"text"])))
);


ALTER TABLE "public"."MatchData" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."MatchData2025" (
    "id" bigint NOT NULL,
    "prematch_team_number" "text",
    "auto_coral" smallint NOT NULL,
    "auto_leave" smallint,
    "teleop_coral" smallint,
    "teleop_net" smallint,
    "teleop_processor" smallint,
    "endgame_climb" smallint,
    "postmatch_defense" smallint,
    "postmatch_died" smallint,
    "prematch_match_number" smallint,
    "event" "text"
);


ALTER TABLE "public"."MatchData2025" OWNER TO "postgres";


COMMENT ON TABLE "public"."MatchData2025" IS 'Archived 2025-season match scouting data (2025cafr). Superseded by the 2026 MatchData schema.';


CREATE TABLE IF NOT EXISTS "public"."MatchDataUploaded2025" (
    "id" bigint NOT NULL,
    "prematch_team_number" "text",
    "auto_coral" smallint NOT NULL,
    "auto_leave" smallint,
    "teleop_coral" smallint,
    "teleop_net" smallint,
    "teleop_processor" smallint,
    "endgame_climb" smallint,
    "postmatch_defense" smallint,
    "postmatch_died" smallint,
    "prematch_match_number" smallint,
    "event" "text",
    "key" "text" NOT NULL,
    "source" "text"
);


ALTER TABLE "public"."MatchDataUploaded2025" OWNER TO "postgres";


COMMENT ON TABLE "public"."MatchDataUploaded2025" IS 'Archived 2025-season match scouting data (2025cafr). Superseded by the consolidated 2026 MatchData table.';


CREATE TABLE IF NOT EXISTS "public"."PitData" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text",
    "scouted_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "pit_team_number" smallint NOT NULL,
    "pit_drivetrain" "text",
    "pit_drive_motor_type" "text" NOT NULL,
    "pit_length" real NOT NULL,
    "pit_width" real NOT NULL,
    "pit_weight" real NOT NULL,
    "pit_archetype" "text" NOT NULL,
    "pit_language" "text" NOT NULL,
    "pit_num_batteries" smallint NOT NULL,
    "pit_num_chargers" smallint NOT NULL,
    "pit_traverse_bump" boolean DEFAULT false NOT NULL,
    "pit_traverse_trench" boolean DEFAULT false NOT NULL,
    "pit_outpost_fuel" boolean DEFAULT false NOT NULL,
    "pit_shoot_close" boolean DEFAULT false NOT NULL,
    "pit_shoot_tower" boolean DEFAULT false NOT NULL,
    "pit_shoot_corner" boolean DEFAULT false NOT NULL,
    "pit_shoot_trench" boolean DEFAULT false NOT NULL,
    "pit_climb" "text" NOT NULL,
    "pit_climb_auto" boolean DEFAULT false NOT NULL,
    "pit_auto_strategy" "text" DEFAULT ''::"text" NOT NULL,
    "pit_cycle_rate" real,
    "pit_defense" boolean DEFAULT false NOT NULL,
    "pit_driver_new" boolean DEFAULT false NOT NULL,
    "pit_system_check" "text" DEFAULT 'before_every_match'::"text" NOT NULL,
    "pit_vibe_check" smallint NOT NULL,
    "pit_comments" "text",
    CONSTRAINT "PitData_vibe_check_check" CHECK ((("pit_vibe_check" >= 1) AND ("pit_vibe_check" <= 5)))
);


ALTER TABLE "public"."PitData" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreScoutData" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text",
    "scouted_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "prescout_team_number" smallint NOT NULL,
    "prescout_epa" real,
    "prescout_archetype" "text",
    "prescout_scoring_tier" "text",
    "prescout_driving_tier" "text",
    "prescout_defense_tier" "text"
);


ALTER TABLE "public"."PreScoutData" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreScoutComment" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text",
    "scouted_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "prescout_team_number" smallint NOT NULL,
    "comment" "text" NOT NULL
);


ALTER TABLE "public"."PreScoutComment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."AutoPath" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text" NOT NULL,
    "scouted_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "team_number" smallint NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "alliance" "text" NOT NULL,
    "side" "text" NOT NULL,
    "path" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    CONSTRAINT "AutoPath_alliance_check" CHECK (("alliance" = ANY (ARRAY['red'::"text", 'blue'::"text"]))),
    CONSTRAINT "AutoPath_side_check" CHECK (("side" = ANY (ARRAY['left'::"text", 'right'::"text"])))
);


ALTER TABLE "public"."AutoPath" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Match" (
    "key" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "comp_level" "text" NOT NULL,
    "set_number" smallint NOT NULL,
    "match_number" smallint NOT NULL,
    "red1" smallint,
    "red2" smallint,
    "red3" smallint,
    "blue1" smallint,
    "blue2" smallint,
    "blue3" smallint
);


ALTER TABLE "public"."Match" OWNER TO "postgres";


ALTER TABLE "public"."MatchData" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."MatchData_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."MatchDataUploaded2025" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."MatchDataUploaded2025_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."MatchData2025" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."MatchData2025_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."PitData" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."PitData_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."PreScoutData" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."PreScoutData_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."PreScoutComment" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."PreScoutComment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."AutoPath" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."AutoPath_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


ALTER TABLE "public"."StrategyBoard" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."StrategyBoard_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."PickList" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "event_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "team_numbers" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "team_tiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "picked_team_numbers" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "archetype" "text" DEFAULT 'scorer'::"text" NOT NULL,
    CONSTRAINT "PickList_type_check" CHECK (("type" = ANY (ARRAY['personal'::"text", 'team'::"text"]))),
    CONSTRAINT "PickList_archetype_check" CHECK (("archetype" = ANY (ARRAY['scorer'::"text", 'defender'::"text"])))
);


ALTER TABLE "public"."PickList" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Watchlist" (
    "event_id" "text" NOT NULL,
    "team_number" smallint NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."Watchlist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Playoffs" (
    "event_id" "text" NOT NULL,
    "alliances" "jsonb" DEFAULT '[[],[],[],[],[],[],[],[]]'::"jsonb" NOT NULL,
    "match_winners" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."Playoffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ScoutAssignment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "text" NOT NULL,
    "match_number" smallint NOT NULL,
    "scout_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "alliance" "text" NOT NULL,
    "slot_index" smallint NOT NULL,
    CONSTRAINT "ScoutAssignment_alliance_check" CHECK (("alliance" = ANY (ARRAY['red'::"text", 'blue'::"text"]))),
    CONSTRAINT "ScoutAssignment_slot_index_check" CHECK ((("slot_index" >= 1) AND ("slot_index" <= 3)))
);


ALTER TABLE "public"."ScoutAssignment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightSetting" (
    "id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text"
);


ALTER TABLE "public"."PreflightSetting" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightScheduleItem" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "match_key" "text",
    "match_info" "jsonb",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text",
    "phase" "text",
    CONSTRAINT "PreflightScheduleItem_kind_check" CHECK (("kind" = ANY (ARRAY['match'::"text", 'custom'::"text", 'milestone'::"text"]))),
    CONSTRAINT "PreflightScheduleItem_category_check" CHECK (("category" = ANY (ARRAY['event'::"text", 'match'::"text", 'pit'::"text", 'admin'::"text", 'practice'::"text", 'programming'::"text"]))),
    CONSTRAINT "PreflightScheduleItem_phase_check" CHECK ((("phase" IS NULL) OR ("phase" = ANY (ARRAY['prep'::"text", 'competition'::"text", 'elimination'::"text", 'closeout'::"text"]))))
);


ALTER TABLE "public"."PreflightScheduleItem" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightTask" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "sort_order" double precision DEFAULT 0 NOT NULL,
    "match_key" "text",
    "assignee" "text",
    "started_at" timestamp with time zone,
    "started_by_name" "text",
    "completed_at" timestamp with time zone,
    "completed_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text"
);


ALTER TABLE "public"."PreflightTask" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightRobotStatusLog" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "status" "text" NOT NULL,
    "pending_label" "text",
    "note" "text",
    "set_at" timestamp with time zone NOT NULL,
    "set_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text",
    "run_id" "uuid",
    "checklist_index" smallint,
    "match_key" "text",
    "checklist_id" "text",
    CONSTRAINT "PreflightRobotStatusLog_status_check" CHECK (("status" = ANY (ARRAY['inbound'::"text", 'pending'::"text", 'repair'::"text", 'ready'::"text", 'away'::"text", 'practice'::"text", 'break'::"text", 'day_ended'::"text"])))
);


ALTER TABLE "public"."PreflightRobotStatusLog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightChecklistCheck" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "run_id" "uuid" NOT NULL,
    "checklist_id" "text" NOT NULL,
    "checklist_name" "text",
    "step_id" "text" NOT NULL,
    "step_title" "text",
    "completed_at" timestamp with time zone,
    "completed_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text",
    "value" "text",
    "match_key" "text"
);


ALTER TABLE "public"."PreflightChecklistCheck" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightChecklistRun" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "checklist_id" "text" NOT NULL,
    "checklist_name" "text" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "label" "text",
    "match_key" "text",
    "started_at" timestamp with time zone NOT NULL,
    "started_by_name" "text",
    "completed_at" timestamp with time zone,
    "completed_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text"
);


ALTER TABLE "public"."PreflightChecklistRun" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightNote" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" double precision DEFAULT 0 NOT NULL,
    "match_key" "text",
    "robot" "text",
    "subsystem" "text",
    "noted_at" timestamp with time zone NOT NULL,
    "created_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text"
);


ALTER TABLE "public"."PreflightNote" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightRepair" (
    "id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "details" "text",
    "subsystem" "text",
    "component" "text",
    "robot" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assignee" "text",
    "match_key" "text",
    "task_id" "uuid",
    "run_id" "uuid",
    "source" "text" DEFAULT 'standalone'::"text" NOT NULL,
    "reported_at" timestamp with time zone NOT NULL,
    "reported_by_name" "text",
    "started_at" timestamp with time zone,
    "started_by_name" "text",
    "finished_at" timestamp with time zone,
    "finished_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text",
    CONSTRAINT "PreflightRepair_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'done'::"text"]))),
    CONSTRAINT "PreflightRepair_source_check" CHECK (("source" = ANY (ARRAY['standalone'::"text", 'task'::"text", 'checklist'::"text"])))
);


ALTER TABLE "public"."PreflightRepair" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightBattery" (
    "id" "uuid" NOT NULL,
    "number" integer NOT NULL,
    "label" "text",
    "purchase_date" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text",
    CONSTRAINT "PreflightBattery_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspect'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."PreflightBattery" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightBatteryMeasurement" (
    "id" "uuid" NOT NULL,
    "battery_id" "uuid" NOT NULL,
    "measured_at" timestamp with time zone NOT NULL,
    "resting_voltage" numeric,
    "internal_resistance_mohm" numeric,
    "state_of_charge" numeric,
    "capacity_wh" numeric,
    "observations" "text",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "measured_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text"
);


ALTER TABLE "public"."PreflightBatteryMeasurement" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."PreflightBatteryUse" (
    "id" "uuid" NOT NULL,
    "battery_id" "uuid" NOT NULL,
    "event_key" "text",
    "kind" "text" DEFAULT 'match'::"text" NOT NULL,
    "match_key" "text",
    "label" "text",
    "run_id" "uuid",
    "installed_at" timestamp with time zone NOT NULL,
    "installed_by_name" "text",
    "removed_at" timestamp with time zone,
    "removed_by_name" "text",
    "updated_at" timestamp with time zone NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_by_name" "text",
    CONSTRAINT "PreflightBatteryUse_kind_check" CHECK (("kind" = ANY (ARRAY['match'::"text", 'test'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."PreflightBatteryUse" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."StrategyBoard" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text" NOT NULL,
    "match_number" smallint NOT NULL,
    "scouted_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "board" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "auto_selections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."StrategyBoard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."RobotPhoto" (
    "team_number" smallint NOT NULL,
    "photo_url" "text"
);


ALTER TABLE "public"."RobotPhoto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Team" (
    "key" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "team_number" smallint,
    "name" "text"
);


ALTER TABLE "public"."Team" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."User" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'observer'::"text" NOT NULL,
    "name" "text",
    "preflight_role" "text" DEFAULT 'observer'::"text" NOT NULL,
    CONSTRAINT "User_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'lead'::"text", 'member'::"text", 'observer'::"text"]))),
    CONSTRAINT "User_preflight_role_check" CHECK (("preflight_role" = ANY (ARRAY['admin'::"text", 'lead'::"text", 'member'::"text", 'observer'::"text"])))
);


ALTER TABLE "public"."User" OWNER TO "postgres";


CREATE OR REPLACE TRIGGER "enforce_user_profile_update" BEFORE UPDATE ON "public"."User" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_user_profile_update"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightSetting" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightScheduleItem" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightTask" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightRobotStatusLog" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightChecklistCheck" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightChecklistRun" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightNote" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightRepair" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightBattery" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightBatteryMeasurement" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();



CREATE OR REPLACE TRIGGER "preflight_sync_row" BEFORE INSERT OR UPDATE ON "public"."PreflightBatteryUse" FOR EACH ROW EXECUTE FUNCTION "public"."preflight_sync_row"();


ALTER TABLE ONLY "public"."Event"
    ADD CONSTRAINT "Event_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."MatchData"
    ADD CONSTRAINT "MatchData_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."MatchData"
    ADD CONSTRAINT "MatchData_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."MatchDataUploaded2025"
    ADD CONSTRAINT "MatchDataUploaded2025_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."MatchData2025"
    ADD CONSTRAINT "MatchData2025_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PitData"
    ADD CONSTRAINT "PitData_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreScoutData"
    ADD CONSTRAINT "PreScoutData_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreScoutComment"
    ADD CONSTRAINT "PreScoutComment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."AutoPath"
    ADD CONSTRAINT "AutoPath_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."StrategyBoard"
    ADD CONSTRAINT "StrategyBoard_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Match"
    ADD CONSTRAINT "Match_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."PickList"
    ADD CONSTRAINT "PickList_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Watchlist"
    ADD CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("event_id", "team_number");



ALTER TABLE ONLY "public"."Playoffs"
    ADD CONSTRAINT "Playoffs_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."ScoutAssignment"
    ADD CONSTRAINT "ScoutAssignment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightSetting"
    ADD CONSTRAINT "PreflightSetting_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightSetting"
    ADD CONSTRAINT "PreflightSetting_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."PreflightScheduleItem"
    ADD CONSTRAINT "PreflightScheduleItem_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightTask"
    ADD CONSTRAINT "PreflightTask_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightRobotStatusLog"
    ADD CONSTRAINT "PreflightRobotStatusLog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightChecklistCheck"
    ADD CONSTRAINT "PreflightChecklistCheck_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightChecklistRun"
    ADD CONSTRAINT "PreflightChecklistRun_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightNote"
    ADD CONSTRAINT "PreflightNote_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightRepair"
    ADD CONSTRAINT "PreflightRepair_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightBattery"
    ADD CONSTRAINT "PreflightBattery_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightBatteryMeasurement"
    ADD CONSTRAINT "PreflightBatteryMeasurement_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."PreflightBatteryUse"
    ADD CONSTRAINT "PreflightBatteryUse_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."RobotPhoto"
    ADD CONSTRAINT "RobotPhoto_pkey" PRIMARY KEY ("team_number");



ALTER TABLE ONLY "public"."RobotPhoto"
    ADD CONSTRAINT "RobotPhoto_team_number_key" UNIQUE ("team_number");



ALTER TABLE ONLY "public"."Team"
    ADD CONSTRAINT "Team_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY ("user_id");



CREATE UNIQUE INDEX "autopath_default_unique" ON "public"."AutoPath" USING "btree" ("team_number", "event") WHERE ("is_default" = true);



CREATE UNIQUE INDEX "prescout_data_team_unique" ON "public"."PreScoutData" USING "btree" ("event", "prescout_team_number");



CREATE UNIQUE INDEX "prescout_comment_scout_unique" ON "public"."PreScoutComment" USING "btree" ("event", "prescout_team_number", "scouted_by");



CREATE UNIQUE INDEX "strategyboard_match_unique" ON "public"."StrategyBoard" USING "btree" ("event", "match_number");



CREATE UNIQUE INDEX "picklist_personal_unique" ON "public"."PickList" USING "btree" ("user_id", "event_id", "type", "archetype") WHERE ("type" = 'personal'::"text");



CREATE UNIQUE INDEX "picklist_team_unique" ON "public"."PickList" USING "btree" ("event_id", "type", "archetype") WHERE ("type" = 'team'::"text");



CREATE UNIQUE INDEX "scoutassignment_slot_unique" ON "public"."ScoutAssignment" USING "btree" ("event_id", "match_number", "alliance", "slot_index");



CREATE INDEX "preflight_setting_synced_at_idx" ON "public"."PreflightSetting" USING "btree" ("synced_at");



CREATE INDEX "preflight_schedule_item_synced_at_idx" ON "public"."PreflightScheduleItem" USING "btree" ("synced_at");



CREATE INDEX "preflight_task_synced_at_idx" ON "public"."PreflightTask" USING "btree" ("synced_at");



CREATE INDEX "preflight_robot_status_log_synced_at_idx" ON "public"."PreflightRobotStatusLog" USING "btree" ("synced_at");



CREATE INDEX "preflight_checklist_check_synced_at_idx" ON "public"."PreflightChecklistCheck" USING "btree" ("synced_at");



CREATE INDEX "preflight_checklist_run_synced_at_idx" ON "public"."PreflightChecklistRun" USING "btree" ("synced_at");



CREATE INDEX "preflight_note_synced_at_idx" ON "public"."PreflightNote" USING "btree" ("synced_at");



CREATE INDEX "preflight_repair_synced_at_idx" ON "public"."PreflightRepair" USING "btree" ("synced_at");



CREATE INDEX "preflight_battery_synced_at_idx" ON "public"."PreflightBattery" USING "btree" ("synced_at");



CREATE INDEX "preflight_battery_measurement_synced_at_idx" ON "public"."PreflightBatteryMeasurement" USING "btree" ("synced_at");



CREATE INDEX "preflight_battery_use_synced_at_idx" ON "public"."PreflightBatteryUse" USING "btree" ("synced_at");



ALTER TABLE ONLY "public"."PickList"
    ADD CONSTRAINT "PickList_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."User"
    ADD CONSTRAINT "User_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."MatchData"
    ADD CONSTRAINT "MatchData_scouted_by_fkey" FOREIGN KEY ("scouted_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."PitData"
    ADD CONSTRAINT "PitData_scouted_by_fkey" FOREIGN KEY ("scouted_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."PreScoutData"
    ADD CONSTRAINT "PreScoutData_scouted_by_fkey" FOREIGN KEY ("scouted_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."PreScoutComment"
    ADD CONSTRAINT "PreScoutComment_scouted_by_fkey" FOREIGN KEY ("scouted_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."AutoPath"
    ADD CONSTRAINT "AutoPath_scouted_by_fkey" FOREIGN KEY ("scouted_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."StrategyBoard"
    ADD CONSTRAINT "StrategyBoard_scouted_by_fkey" FOREIGN KEY ("scouted_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."Match"
    ADD CONSTRAINT "Match_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id");



ALTER TABLE ONLY "public"."Watchlist"
    ADD CONSTRAINT "Watchlist_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id");



ALTER TABLE ONLY "public"."Playoffs"
    ADD CONSTRAINT "Playoffs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id");



ALTER TABLE ONLY "public"."Playoffs"
    ADD CONSTRAINT "Playoffs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."Watchlist"
    ADD CONSTRAINT "Watchlist_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."User"("user_id");



ALTER TABLE ONLY "public"."ScoutAssignment"
    ADD CONSTRAINT "ScoutAssignment_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id");



ALTER TABLE ONLY "public"."ScoutAssignment"
    ADD CONSTRAINT "ScoutAssignment_scout_user_id_fkey" FOREIGN KEY ("scout_user_id") REFERENCES "public"."User"("user_id");



CREATE POLICY "Enable insert for authenticated users" ON "public"."RobotPhoto" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."AutoPath" FOR INSERT TO "authenticated" WITH CHECK (("scouted_by" = "auth"."uid"()));



CREATE POLICY "Enable read access for logged in users" ON "public"."AutoPath" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."AutoPath" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable delete for authenticated users only" ON "public"."AutoPath" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."StrategyBoard" FOR INSERT TO "authenticated" WITH CHECK (("scouted_by" = "auth"."uid"()));



CREATE POLICY "Enable read access for logged in users" ON "public"."StrategyBoard" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."StrategyBoard" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable delete for authenticated users only" ON "public"."StrategyBoard" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."MatchData" FOR INSERT TO "authenticated" WITH CHECK (("scouted_by" = "auth"."uid"()));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."PitData" FOR INSERT TO "authenticated" WITH CHECK (("scouted_by" = "auth"."uid"()));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."PreScoutData" FOR INSERT TO "authenticated" WITH CHECK (("scouted_by" = "auth"."uid"()));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."PreScoutComment" FOR INSERT TO "authenticated" WITH CHECK (("scouted_by" = "auth"."uid"()));



CREATE POLICY "Enable read access for authenticated users" ON "public"."PickList" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."Event" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."MatchData" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."PitData" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."PreScoutData" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."PreScoutComment" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."MatchData2025" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."Match" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for authenticated users" ON "public"."MatchDataUploaded2025" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."RobotPhoto" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."Team" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."User" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for own profile" ON "public"."User" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("role" = 'observer'::"text") AND ("preflight_role" = 'observer'::"text")));



CREATE POLICY "Enable update for authenticated users" ON "public"."User" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable update for authenticated users" ON "public"."RobotPhoto" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."MatchData" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable delete for authenticated users only" ON "public"."MatchData" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."PitData" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."PreScoutData" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."PreScoutComment" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable write access for personal lists" ON "public"."PickList" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));

CREATE POLICY "Enable write access for picklists" ON "public"."PickList" TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."Watchlist" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."Watchlist" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable delete for authenticated users only" ON "public"."Watchlist" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."Playoffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for leads and admins" ON "public"."Playoffs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for leads and admins" ON "public"."Playoffs" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."ScoutAssignment" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."ScoutAssignment" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."ScoutAssignment" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Enable delete for authenticated users only" ON "public"."ScoutAssignment" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightSetting" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for leads and admins" ON "public"."PreflightSetting" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for leads and admins" ON "public"."PreflightSetting" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightScheduleItem" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for leads and admins" ON "public"."PreflightScheduleItem" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for leads and admins" ON "public"."PreflightScheduleItem" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for members" ON "public"."PreflightTask" FOR SELECT TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable insert for members" ON "public"."PreflightTask" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightTask" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightRobotStatusLog" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightRobotStatusLog" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightRobotStatusLog" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));




CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightChecklistCheck" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightChecklistCheck" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightChecklistCheck" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightChecklistRun" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightChecklistRun" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightChecklistRun" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for members" ON "public"."PreflightNote" FOR SELECT TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable insert for members" ON "public"."PreflightNote" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightNote" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightRepair" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightRepair" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightRepair" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightBattery" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightBattery" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightBattery" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightBatteryMeasurement" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightBatteryMeasurement" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightBatteryMeasurement" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable read access for logged in users" ON "public"."PreflightBatteryUse" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable insert for members" ON "public"."PreflightBatteryUse" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));



CREATE POLICY "Enable update for members" ON "public"."PreflightBatteryUse" FOR UPDATE TO "authenticated" USING ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS (SELECT 1 FROM "public"."User" "u" WHERE (("u"."user_id" = "auth"."uid"()) AND ("u"."preflight_role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'admin'::"text"]))))));


ALTER TABLE "public"."Event" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."MatchData" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PitData" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreScoutData" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreScoutComment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."AutoPath" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."StrategyBoard" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Match" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."MatchData2025" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."MatchDataUploaded2025" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PickList" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."RobotPhoto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Team" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Watchlist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Playoffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ScoutAssignment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightSetting" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightScheduleItem" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."PreflightTask" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightRobotStatusLog" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."PreflightChecklistCheck" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightChecklistRun" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightNote" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightRepair" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightBattery" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightBatteryMeasurement" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."PreflightBatteryUse" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;












GRANT ALL ON TABLE "public"."Event" TO "anon";
GRANT ALL ON TABLE "public"."Event" TO "authenticated";
GRANT ALL ON TABLE "public"."Event" TO "service_role";



GRANT ALL ON TABLE "public"."MatchData" TO "anon";
GRANT ALL ON TABLE "public"."MatchData" TO "authenticated";
GRANT ALL ON TABLE "public"."MatchData" TO "service_role";



GRANT ALL ON SEQUENCE "public"."MatchData_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."MatchData_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."MatchData_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."PitData" TO "anon";
GRANT ALL ON TABLE "public"."PitData" TO "authenticated";
GRANT ALL ON TABLE "public"."PitData" TO "service_role";



GRANT ALL ON TABLE "public"."PreScoutData" TO "anon";
GRANT ALL ON TABLE "public"."PreScoutData" TO "authenticated";
GRANT ALL ON TABLE "public"."PreScoutData" TO "service_role";



GRANT ALL ON TABLE "public"."PreScoutComment" TO "anon";
GRANT ALL ON TABLE "public"."PreScoutComment" TO "authenticated";
GRANT ALL ON TABLE "public"."PreScoutComment" TO "service_role";



GRANT ALL ON SEQUENCE "public"."PitData_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."PitData_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."PitData_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."PreScoutData_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."PreScoutData_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."PreScoutData_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."PreScoutComment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."PreScoutComment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."PreScoutComment_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."AutoPath" TO "anon";
GRANT ALL ON TABLE "public"."AutoPath" TO "authenticated";
GRANT ALL ON TABLE "public"."AutoPath" TO "service_role";



GRANT ALL ON SEQUENCE "public"."AutoPath_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."AutoPath_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."AutoPath_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."StrategyBoard" TO "anon";
GRANT ALL ON TABLE "public"."StrategyBoard" TO "authenticated";
GRANT ALL ON TABLE "public"."StrategyBoard" TO "service_role";



GRANT ALL ON SEQUENCE "public"."StrategyBoard_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."StrategyBoard_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."StrategyBoard_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."Match" TO "anon";
GRANT ALL ON TABLE "public"."Match" TO "authenticated";
GRANT ALL ON TABLE "public"."Match" TO "service_role";



GRANT ALL ON TABLE "public"."MatchData2025" TO "anon";
GRANT ALL ON TABLE "public"."MatchData2025" TO "authenticated";
GRANT ALL ON TABLE "public"."MatchData2025" TO "service_role";



GRANT ALL ON TABLE "public"."MatchDataUploaded2025" TO "anon";
GRANT ALL ON TABLE "public"."MatchDataUploaded2025" TO "authenticated";
GRANT ALL ON TABLE "public"."MatchDataUploaded2025" TO "service_role";



GRANT ALL ON SEQUENCE "public"."MatchDataUploaded2025_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."MatchDataUploaded2025_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."MatchDataUploaded2025_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."MatchData2025_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."MatchData2025_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."MatchData2025_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."PickList" TO "anon";
GRANT ALL ON TABLE "public"."PickList" TO "authenticated";
GRANT ALL ON TABLE "public"."PickList" TO "service_role";



GRANT ALL ON TABLE "public"."Playoffs" TO "anon";
GRANT ALL ON TABLE "public"."Playoffs" TO "authenticated";
GRANT ALL ON TABLE "public"."Playoffs" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightSetting" TO "anon";
GRANT ALL ON TABLE "public"."PreflightSetting" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightSetting" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightScheduleItem" TO "anon";
GRANT ALL ON TABLE "public"."PreflightScheduleItem" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightScheduleItem" TO "service_role";




GRANT ALL ON TABLE "public"."PreflightTask" TO "anon";
GRANT ALL ON TABLE "public"."PreflightTask" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightTask" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightRobotStatusLog" TO "anon";
GRANT ALL ON TABLE "public"."PreflightRobotStatusLog" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightRobotStatusLog" TO "service_role";




GRANT ALL ON TABLE "public"."PreflightChecklistCheck" TO "anon";
GRANT ALL ON TABLE "public"."PreflightChecklistCheck" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightChecklistCheck" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightChecklistRun" TO "anon";
GRANT ALL ON TABLE "public"."PreflightChecklistRun" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightChecklistRun" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightNote" TO "anon";
GRANT ALL ON TABLE "public"."PreflightNote" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightNote" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightRepair" TO "anon";
GRANT ALL ON TABLE "public"."PreflightRepair" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightRepair" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightBattery" TO "anon";
GRANT ALL ON TABLE "public"."PreflightBattery" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightBattery" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightBatteryMeasurement" TO "anon";
GRANT ALL ON TABLE "public"."PreflightBatteryMeasurement" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightBatteryMeasurement" TO "service_role";



GRANT ALL ON TABLE "public"."PreflightBatteryUse" TO "anon";
GRANT ALL ON TABLE "public"."PreflightBatteryUse" TO "authenticated";
GRANT ALL ON TABLE "public"."PreflightBatteryUse" TO "service_role";



GRANT ALL ON TABLE "public"."RobotPhoto" TO "anon";
GRANT ALL ON TABLE "public"."RobotPhoto" TO "authenticated";
GRANT ALL ON TABLE "public"."RobotPhoto" TO "service_role";



GRANT ALL ON TABLE "public"."Team" TO "anon";
GRANT ALL ON TABLE "public"."Team" TO "authenticated";
GRANT ALL ON TABLE "public"."Team" TO "service_role";



GRANT ALL ON TABLE "public"."User" TO "anon";
GRANT ALL ON TABLE "public"."User" TO "authenticated";
GRANT ALL ON TABLE "public"."User" TO "service_role";



SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































