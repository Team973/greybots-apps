// Supabase Edge Function: proxies The Blue Alliance API requests so the TBA
// API key, and the service-role key needed to write the Match table (which
// has no INSERT/DELETE policy for authenticated clients — see
// supabase/database/schemas/prod.sql), never reach the browser (issue #26).
//
// Actions (POST body: { action, event_id, team_number? }):
//   - get_oprs: any authenticated user. Passes through TBA's
//     /event/{event_id}/oprs response verbatim (no DB write).
//   - get_team_schedule: any authenticated user. Returns the event's
//     name/dates/timezone and team_number's matches at the event, including
//     scheduled/predicted/actual times (no DB write). Used by Preflight's
//     schedule, which stores the result in its own synced tables.
//   - refresh_schedule: lead/admin only. Ports
//     util/match_schedule.py's update_match_schedule_for_event — full
//     delete+insert of the event's Match rows. ScoutAssignment isn't FK'd to
//     Match (it's keyed by event_id/match_number/alliance/slot_index), so
//     this doesn't disturb existing scout schedules.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Converts a TBA team key like "frc973" to 973, or null for an unfilled/surrogate slot.
function teamNumberFromKey(teamKey: string | undefined): number | null {
  if (!teamKey || !teamKey.startsWith("frc")) return null;
  const n = Number(teamKey.slice(3));
  return Number.isFinite(n) ? n : null;
}

function tbaFetch(path: string, apiKey: string) {
  return fetch(`${TBA_BASE_URL}${path}`, {
    headers: { "X-TBA-Auth-Key": apiKey },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const tbaApiKey = Deno.env.get("TBA_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!tbaApiKey || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server misconfigured: missing TBA/Supabase credentials." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header." }, 401);
  }

  // Service-role client, scoped to the caller's own JWT purely to identify
  // who's asking (auth.getUser() validates the token against Supabase Auth).
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return jsonResponse({ error: "Not authenticated." }, 401);
  }

  let body: { action?: string; event_id?: string; team_number?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { action, event_id: eventId } = body;
  if (!eventId || typeof eventId !== "string") {
    return jsonResponse({ error: "event_id is required." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (action === "get_oprs") {
    const response = await tbaFetch(`/event/${eventId}/oprs`, tbaApiKey);
    if (!response.ok) {
      return jsonResponse({ error: `TBA request failed: ${response.status}` }, 502);
    }
    return jsonResponse(await response.json());
  }

  if (action === "get_team_schedule") {
    const teamNumber = Number(body.team_number);
    if (!Number.isInteger(teamNumber) || teamNumber <= 0) {
      return jsonResponse({ error: "team_number is required." }, 400);
    }

    const [eventResponse, matchesResponse] = await Promise.all([
      tbaFetch(`/event/${eventId}`, tbaApiKey),
      // The full model (not /simple) for post_result_time, i.e. when the
      // match actually finished. Trimmed below to the fields Preflight uses.
      tbaFetch(`/team/frc${teamNumber}/event/${eventId}/matches`, tbaApiKey),
    ]);
    if (eventResponse.status === 404) {
      return jsonResponse({ error: `Event ${eventId} not found on TBA.` }, 404);
    }
    if (!eventResponse.ok || !matchesResponse.ok) {
      return jsonResponse({ error: `TBA request failed: ${eventResponse.status}/${matchesResponse.status}` }, 502);
    }

    const event = await eventResponse.json();
    const matches = await matchesResponse.json();
    return jsonResponse({
      event: {
        key: event.key,
        name: event.short_name || event.name,
        start_date: event.start_date,
        end_date: event.end_date,
        timezone: event.timezone,
      },
      matches: (Array.isArray(matches) ? matches : []).map((match) => ({
        key: match.key,
        comp_level: match.comp_level,
        set_number: match.set_number,
        match_number: match.match_number,
        alliances: {
          red: { team_keys: match.alliances?.red?.team_keys ?? [] },
          blue: { team_keys: match.alliances?.blue?.team_keys ?? [] },
        },
        time: match.time ?? null,
        predicted_time: match.predicted_time ?? null,
        actual_time: match.actual_time ?? null,
        post_result_time: match.post_result_time ?? null,
      })),
    });
  }

  if (action === "refresh_schedule") {
    const { data: userRow, error: roleError } = await adminClient
      .from("User")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !userRow || (userRow.role !== "lead" && userRow.role !== "admin")) {
      return jsonResponse({ error: "Only leads and admins can refresh the match schedule." }, 403);
    }

    const response = await tbaFetch(`/event/${eventId}/matches/simple`, tbaApiKey);
    if (!response.ok) {
      return jsonResponse({ error: `TBA request failed: ${response.status}` }, 502);
    }

    const matches = await response.json();
    if (!Array.isArray(matches)) {
      return jsonResponse({ error: "Unexpected TBA response for match schedule." }, 502);
    }

    const rows = matches.map((match) => {
      const redTeams = match.alliances?.red?.team_keys ?? [];
      const blueTeams = match.alliances?.blue?.team_keys ?? [];
      return {
        key: match.key,
        event_id: eventId,
        comp_level: match.comp_level,
        set_number: match.set_number,
        match_number: match.match_number,
        red1: teamNumberFromKey(redTeams[0]),
        red2: teamNumberFromKey(redTeams[1]),
        red3: teamNumberFromKey(redTeams[2]),
        blue1: teamNumberFromKey(blueTeams[0]),
        blue2: teamNumberFromKey(blueTeams[1]),
        blue3: teamNumberFromKey(blueTeams[2]),
      };
    });

    // Full replace rather than upsert: TBA regenerates an event's schedule
    // (e.g. a new playoff bracket after tiebreakers), which can drop matches
    // that existed under the old schedule.
    const { error: deleteError } = await adminClient.from("Match").delete().eq("event_id", eventId);
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500);
    }

    if (rows.length > 0) {
      const { error: insertError } = await adminClient.from("Match").insert(rows);
      if (insertError) {
        return jsonResponse({ error: insertError.message }, 500);
      }
    }

    return jsonResponse({ matchCount: rows.length });
  }

  return jsonResponse({ error: `Unknown action: ${action}` }, 400);
});
