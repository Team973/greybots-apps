
import datetime
import re

from supabase_client_interface import create_supabase_client
from tba_client import TBAClient

# import types
from supabase import Client

EVENT_TABLE = "Event"
TEAM_TABLE = "Team"

# Same rule as the app's src/lib/team-number.ts.
TEAM_NUMBER_PATTERN = re.compile(r"^[1-9]\d{0,5}[A-Z]?$")


def _team_number_from_key(team_key):
    """"frc973B" -> "973B", or None if it isn't a team key."""
    number = str(team_key)[3:].upper() if str(team_key).startswith("frc") else ""
    return number if TEAM_NUMBER_PATTERN.match(number) else None


def _remapped_teams(remap_teams, names):
    """Returns (team_number, name) for each lettered team in the event's
    remap_teams, named after its parent team, e.g. "Greybots (B)". Mirrors the
    tba-proxy function's remappedTeams.
    """
    remapped = []
    for team_key in remap_teams.values():
        number = _team_number_from_key(team_key)
        if not number or not number[-1].isalpha() or number in names:
            continue
        parent_name = names.get(number[:-1])
        remapped.append((number, f"{parent_name} ({number[-1]})" if parent_name else f"Team {number}"))
        names[number] = remapped[-1][1]
    return remapped


def update_attendance_list_for_all_events(sb_credentials, tba_credentials):
    # Get the list of event IDs
    sb_client = create_supabase_client(sb_credentials)
    events = sb_client.table(EVENT_TABLE).select("*").execute()

    for e in events.data:
        print(e)
        update_team_info_for_event(sb_credentials, tba_credentials, e['event_id'])


def update_event_info_for_team(sb_credentials, tba_credentials, team_number):
    # Create API clients.
    sb_client = create_supabase_client(sb_credentials)
    tba_client = TBAClient(tba_credentials['base_url'], tba_credentials['api_key'])

    # Get the current year so we can figure out which events we are attending.
    today = datetime.date.today()
    current_year = today.year

    # Query TBA to find all events being attended by the team this year.
    team_events_response = tba_client.get_data(f"/team/frc{team_number}/events/{current_year}")
    team_events = team_events_response.json()

    for i in range(len(team_events)):
        event = team_events[i]

        if 'key' in event and 'short_name' in event and 'start_date' in event and 'end_date' in event:
            event_id = event['key']
            name = event['short_name']
            start = event['start_date']
            end = event['end_date']

            # Publish the event to the Event table.
            event_dict = {
                'event_id': event_id,
                'name': name,
                'start_date': start,
                'end_date': end
            }
            sb_client.table(EVENT_TABLE).upsert(event_dict).execute()

            print(f"{event_id}: {name}, {start} - {end}")


def update_team_info_for_event(sb_credentials, tba_credentials, event_id):
    # Create API clients.
    sb_client = create_supabase_client(sb_credentials)
    tba_client = TBAClient(tba_credentials['base_url'], tba_credentials['api_key'])

    # Query TBA to find all teams at the specified event
    event_teams_response = tba_client.get_data(f"/event/{event_id}/teams")
    event_teams = event_teams_response.json()

    if not isinstance(event_teams, list):
        return

    # B teams aren't in TBA's team list: the event registers them under
    # generic placeholder numbers (frc9973), and usually only right before the
    # event remaps each one to its B team (frc973B), which is the key the
    # match schedule then uses.
    event_response = tba_client.get_data(f"/event/{event_id}")
    if event_response.status_code != 200:
        print(f"{event_id}: couldn't fetch the event ({event_response.status_code})")
        return
    remap_teams = event_response.json().get('remap_teams') or {}

    # Anything scouted or ranked under a placeholder moves to its B team.
    if remap_teams:
        moved = sb_client.rpc("remap_event_teams", {"p_event_id": event_id, "p_remap": remap_teams}).execute()
        if isinstance(moved.data, dict) and any(moved.data.values()):
            print(f"{event_id}: moved placeholder team data {moved.data}")

    # Team numbers are text (B teams like "973B"); TBA's team list only has
    # real teams, numbered as integers.
    placeholders = {_team_number_from_key(key) for key in remap_teams}
    names = {}
    for team in event_teams:
        if 'team_number' in team and 'nickname' in team and str(team['team_number']) not in placeholders:
            names[str(team['team_number'])] = team['nickname']
    teams = list(names.items())
    if teams:
        teams += _remapped_teams(remap_teams, names)

    listed_keys = set()
    for number, name in teams:
        key = f"{event_id}_{number}"
        listed_keys.add(key)

        # Publish the team to the Team table. `custom` isn't sent, so an
        # existing row keeps its value.
        team_dict = {
            'event_id': event_id,
            'name': name,
            'team_number': number,
            'key': key
        }
        sb_client.table(TEAM_TABLE).upsert(team_dict).execute()

    # Remove teams that have dropped out of the event, except custom ones
    # (added by hand, not from TBA). An empty list from TBA means the teams
    # haven't been published, not that every team dropped, so nothing is
    # removed then. Same rule as the tba-proxy function's refresh_event.
    if not listed_keys:
        return

    try:
        existing = sb_client.table(TEAM_TABLE).select("key, team_number").eq("event_id", event_id).eq("custom", False).execute()
    except Exception as e:
        print(f"{event_id}: couldn't check for dropped teams ({e})")
        return

    dropped = [row for row in existing.data if row['key'] not in listed_keys]
    if dropped:
        sb_client.table(TEAM_TABLE).delete().in_("key", [row['key'] for row in dropped]).execute()
        print(f"{event_id}: removed dropped teams {sorted(str(row['team_number']) for row in dropped)}")
