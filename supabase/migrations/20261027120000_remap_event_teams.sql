-- Offseason events register second robots under generic placeholder numbers
-- (frc9972-frc9995) and, usually right before the event, TBA remaps each one
-- to its real B/C/D team (frc9973 -> frc973B) through the event's
-- remap_teams. Anything scouted or ranked in the meantime is stored under the
-- placeholder number, so this moves one event's data from each placeholder
-- to the team it's remapped to.
--
-- Placeholder numbers are reused at every offseason event, so only rows for
-- p_event_id are touched (RobotPhoto isn't per event, and placeholders have
-- no photos). Where the remapped team already has a row that can only exist
-- once (Team, Watchlist, PreScoutData, a scout's PreScoutComment), the
-- remapped team's row wins and the placeholder's is dropped or left alone.
--
-- Called with the service role by the tba-proxy function's refresh_event and
-- the nightly util job, every time they refresh an event's teams. Running it
-- again is harmless: once nothing is stored under a placeholder, it changes
-- nothing. Returns how many rows moved, per table.

CREATE OR REPLACE FUNCTION "public"."remap_event_teams"("p_event_id" "text", "p_remap" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  pair record;
  old_number text;
  new_number text;
  moved bigint;
  counts jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_remap) IS DISTINCT FROM 'object' THEN
    RETURN counts;
  END IF;

  FOR pair IN SELECT key, value FROM jsonb_each_text(p_remap) LOOP
    -- TBA team keys ("frc9973", "frc973B") to team numbers.
    old_number := upper(regexp_replace(pair.key, '^frc', '', 'i'));
    new_number := upper(regexp_replace(pair.value, '^frc', '', 'i'));
    CONTINUE WHEN old_number !~ '^[1-9][0-9]{0,5}[A-Z]?$'
      OR new_number !~ '^[1-9][0-9]{0,5}[A-Z]?$'
      OR old_number = new_number;

    -- Team: the caller names the remapped team after this.
    IF EXISTS (SELECT 1 FROM "Team" WHERE "event_id" = p_event_id AND "team_number" = new_number) THEN
      DELETE FROM "Team" WHERE "event_id" = p_event_id AND "team_number" = old_number;
    ELSE
      UPDATE "Team" SET "team_number" = new_number, "key" = p_event_id || '_' || new_number
        WHERE "event_id" = p_event_id AND "team_number" = old_number;
    END IF;

    UPDATE "Match" SET
      "red1" = CASE WHEN "red1" = old_number THEN new_number ELSE "red1" END,
      "red2" = CASE WHEN "red2" = old_number THEN new_number ELSE "red2" END,
      "red3" = CASE WHEN "red3" = old_number THEN new_number ELSE "red3" END,
      "blue1" = CASE WHEN "blue1" = old_number THEN new_number ELSE "blue1" END,
      "blue2" = CASE WHEN "blue2" = old_number THEN new_number ELSE "blue2" END,
      "blue3" = CASE WHEN "blue3" = old_number THEN new_number ELSE "blue3" END
      WHERE "event_id" = p_event_id
        AND old_number IN ("red1", "red2", "red3", "blue1", "blue2", "blue3");

    UPDATE "MatchData" SET "prematch_team_number" = new_number
      WHERE "event" = p_event_id AND "prematch_team_number" = old_number;
    GET DIAGNOSTICS moved = ROW_COUNT;
    counts := counts || jsonb_build_object('MatchData', COALESCE((counts->>'MatchData')::bigint, 0) + moved);

    UPDATE "PitData" SET "pit_team_number" = new_number
      WHERE "event" = p_event_id AND "pit_team_number" = old_number;
    GET DIAGNOSTICS moved = ROW_COUNT;
    counts := counts || jsonb_build_object('PitData', COALESCE((counts->>'PitData')::bigint, 0) + moved);

    UPDATE "PreScoutData" SET "prescout_team_number" = new_number
      WHERE "event" = p_event_id AND "prescout_team_number" = old_number
        AND NOT EXISTS (SELECT 1 FROM "PreScoutData" d
                        WHERE d."event" = p_event_id AND d."prescout_team_number" = new_number);
    GET DIAGNOSTICS moved = ROW_COUNT;
    counts := counts || jsonb_build_object('PreScoutData', COALESCE((counts->>'PreScoutData')::bigint, 0) + moved);

    UPDATE "PreScoutComment" c SET "prescout_team_number" = new_number
      WHERE c."event" = p_event_id AND c."prescout_team_number" = old_number
        AND NOT EXISTS (SELECT 1 FROM "PreScoutComment" d
                        WHERE d."event" = p_event_id AND d."prescout_team_number" = new_number
                          AND d."scouted_by" IS NOT DISTINCT FROM c."scouted_by");
    GET DIAGNOSTICS moved = ROW_COUNT;
    counts := counts || jsonb_build_object('PreScoutComment', COALESCE((counts->>'PreScoutComment')::bigint, 0) + moved);

    -- Only one default auto path per team: keep the remapped team's.
    IF EXISTS (SELECT 1 FROM "AutoPath" WHERE "event" = p_event_id AND "team_number" = new_number AND "is_default") THEN
      UPDATE "AutoPath" SET "is_default" = false
        WHERE "event" = p_event_id AND "team_number" = old_number AND "is_default";
    END IF;
    UPDATE "AutoPath" SET "team_number" = new_number
      WHERE "event" = p_event_id AND "team_number" = old_number;
    GET DIAGNOSTICS moved = ROW_COUNT;
    counts := counts || jsonb_build_object('AutoPath', COALESCE((counts->>'AutoPath')::bigint, 0) + moved);

    IF EXISTS (SELECT 1 FROM "Watchlist" WHERE "event_id" = p_event_id AND "team_number" = new_number) THEN
      DELETE FROM "Watchlist" WHERE "event_id" = p_event_id AND "team_number" = old_number;
    ELSE
      UPDATE "Watchlist" SET "team_number" = new_number
        WHERE "event_id" = p_event_id AND "team_number" = old_number;
    END IF;

    -- Pick lists: the team keeps its place in the list (and so its divider
    -- section) and its tier.
    UPDATE "PickList" SET
      "team_numbers" = CASE WHEN new_number = ANY("team_numbers")
        THEN array_remove("team_numbers", old_number)
        ELSE array_replace("team_numbers", old_number, new_number) END,
      "picked_team_numbers" = CASE WHEN new_number = ANY("picked_team_numbers")
        THEN array_remove("picked_team_numbers", old_number)
        ELSE array_replace("picked_team_numbers", old_number, new_number) END,
      "team_tiers" = CASE
        WHEN "team_tiers" ? old_number AND NOT "team_tiers" ? new_number
          THEN ("team_tiers" - old_number) || jsonb_build_object(new_number, "team_tiers" -> old_number)
        WHEN "team_tiers" ? old_number THEN "team_tiers" - old_number
        ELSE "team_tiers" END
      WHERE "event_id" = p_event_id
        AND (old_number = ANY("team_numbers") OR old_number = ANY("picked_team_numbers")
             OR COALESCE("team_tiers" ? old_number, false));
    GET DIAGNOSTICS moved = ROW_COUNT;
    counts := counts || jsonb_build_object('PickList', COALESCE((counts->>'PickList')::bigint, 0) + moved);

    -- Playoff alliances are a list of lists of team numbers (numbers or
    -- strings), kept in order.
    UPDATE "Playoffs" SET "alliances" = remap_alliances("alliances", old_number, new_number)
      WHERE "event_id" = p_event_id AND "alliances" IS DISTINCT FROM remap_alliances("alliances", old_number, new_number);
    UPDATE "PlayoffsPrediction" SET "alliances" = remap_alliances("alliances", old_number, new_number)
      WHERE "event_id" = p_event_id AND "alliances" IS DISTINCT FROM remap_alliances("alliances", old_number, new_number);
  END LOOP;

  RETURN counts;
END;
$$;


-- remap_event_teams' helper: replaces old_number with new_number in a list of
-- alliances, each a list of team numbers.
CREATE OR REPLACE FUNCTION "public"."remap_alliances"("p_alliances" "jsonb", "old_number" "text", "new_number" "text") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE WHEN jsonb_typeof(p_alliances) = 'array' THEN
    COALESCE((
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(alliance.value) = 'array' THEN
          COALESCE((
            SELECT jsonb_agg(
              CASE WHEN team.value #>> '{}' = old_number THEN to_jsonb(new_number) ELSE team.value END
              ORDER BY team.position)
            FROM jsonb_array_elements(alliance.value) WITH ORDINALITY AS team(value, position)
          ), '[]'::jsonb)
        ELSE alliance.value END
        ORDER BY alliance.position)
      FROM jsonb_array_elements(p_alliances) WITH ORDINALITY AS alliance(value, position)
    ), '[]'::jsonb)
  ELSE p_alliances END
$$;


ALTER FUNCTION "public"."remap_event_teams"("p_event_id" "text", "p_remap" "jsonb") OWNER TO "postgres";
ALTER FUNCTION "public"."remap_alliances"("p_alliances" "jsonb", "old_number" "text", "new_number" "text") OWNER TO "postgres";

-- Rewrites any event's data, so only the service role (tba-proxy, the
-- nightly job) may call it.
REVOKE ALL ON FUNCTION "public"."remap_event_teams"("p_event_id" "text", "p_remap" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."remap_event_teams"("p_event_id" "text", "p_remap" "jsonb") FROM "anon";
REVOKE ALL ON FUNCTION "public"."remap_event_teams"("p_event_id" "text", "p_remap" "jsonb") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."remap_event_teams"("p_event_id" "text", "p_remap" "jsonb") TO "service_role";
