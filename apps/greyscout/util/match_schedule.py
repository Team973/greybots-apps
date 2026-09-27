
from supabase_client_interface import create_supabase_client
from tba_client import TBAClient

MATCH_TABLE = "Match"


def _team_number_from_key(team_key):
    """Convert a TBA team key like "frc973" to 973, or None for an unfilled/surrogate slot."""
    if not team_key or not team_key.startswith("frc"):
        return None
    try:
        return int(team_key[3:])
    except ValueError:
        return None


def update_match_schedule_for_event(sb_credentials, tba_credentials, event_id):
    sb_client = create_supabase_client(sb_credentials)
    tba_client = TBAClient(tba_credentials['base_url'], tba_credentials['api_key'])

    response = tba_client.get_data(f"/event/{event_id}/matches/simple")
    if response.status_code != 200:
        print(f"Failed to fetch match schedule for {event_id}: {response.status_code}")
        return

    matches = response.json()
    if not isinstance(matches, list):
        print(f"Unexpected match schedule response for {event_id}: {matches}")
        return

    rows = []
    for match in matches:
        alliances = match.get('alliances', {})
        red_teams = alliances.get('red', {}).get('team_keys', [])
        blue_teams = alliances.get('blue', {}).get('team_keys', [])

        rows.append({
            'key': match['key'],
            'event_id': event_id,
            'comp_level': match['comp_level'],
            'set_number': match['set_number'],
            'match_number': match['match_number'],
            'red1': _team_number_from_key(red_teams[0]) if len(red_teams) > 0 else None,
            'red2': _team_number_from_key(red_teams[1]) if len(red_teams) > 1 else None,
            'red3': _team_number_from_key(red_teams[2]) if len(red_teams) > 2 else None,
            'blue1': _team_number_from_key(blue_teams[0]) if len(blue_teams) > 0 else None,
            'blue2': _team_number_from_key(blue_teams[1]) if len(blue_teams) > 1 else None,
            'blue3': _team_number_from_key(blue_teams[2]) if len(blue_teams) > 2 else None,
        })

    # Full replace rather than upsert: TBA regenerates an event's schedule
    # (e.g. a new playoff bracket after tiebreakers), which can drop matches
    # that existed under the old schedule. An upsert alone would leave those
    # stale rows behind, so clear the event's matches before inserting the
    # freshly fetched set.
    sb_client.table(MATCH_TABLE).delete().eq("event_id", event_id).execute()

    if rows:
        sb_client.table(MATCH_TABLE).insert(rows).execute()

    print(f"{event_id}: replaced schedule with {len(rows)} matches")
