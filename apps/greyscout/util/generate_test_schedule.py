
import argparse
import random

from credentials import get_supabase_credentials
from supabase_client_interface import create_supabase_client

TEAM_TABLE = "Team"
MATCH_TABLE = "Match"


def _balanced_match_teams(team_numbers, num_matches, rng):
    """
    Greedily builds `num_matches` qualification matches, each with 6 distinct
    teams. Every match draws its teams from whichever teams have played the
    fewest matches so far (ties broken randomly), so play counts stay within
    1 of each other across the whole schedule.
    """
    counts = {team: 0 for team in team_numbers}
    matches = []

    for _ in range(num_matches):
        pool = sorted(team_numbers, key=lambda t: (counts[t], rng.random()))
        chosen = pool[:6]
        rng.shuffle(chosen)
        for team in chosen:
            counts[team] += 1
        matches.append(chosen)

    return matches


def generate_test_schedule(sb_credentials, event_id, num_matches, seed):
    sb_client = create_supabase_client(sb_credentials)
    rng = random.Random(seed)

    teams_response = sb_client.table(TEAM_TABLE).select("team_number").eq("event_id", event_id).execute()
    team_numbers = sorted({row['team_number'] for row in teams_response.data})

    if len(team_numbers) < 6:
        print(f"{event_id} only has {len(team_numbers)} teams on file — need at least 6 to build a schedule.")
        return

    matches = _balanced_match_teams(team_numbers, num_matches, rng)

    rows = []
    for match_number, teams in enumerate(matches, start=1):
        red, blue = teams[:3], teams[3:]
        rows.append({
            'key': f"TEST_{event_id}_qm{match_number}",
            'event_id': event_id,
            'comp_level': 'qm',
            'set_number': 1,
            'match_number': match_number,
            'red1': red[0], 'red2': red[1], 'red3': red[2],
            'blue1': blue[0], 'blue2': blue[1], 'blue3': blue[2],
        })

    # Full replace, same as the real TBA sync — safe to re-run.
    sb_client.table(MATCH_TABLE).delete().eq("event_id", event_id).execute()
    sb_client.table(MATCH_TABLE).insert(rows).execute()

    plays_per_team = (num_matches * 6) / len(team_numbers)
    print(f"{event_id}: generated {len(rows)} fake qualification matches across {len(team_numbers)} teams "
          f"(~{plays_per_team:.1f} matches/team). Keys are prefixed TEST_ so they're easy to find and clear later.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate a fake qualification schedule from an event's real Team roster, for testing only.")
    parser.add_argument("--event_id", default="2026cc")
    parser.add_argument("--num_matches", type=int, default=72)
    parser.add_argument("--seed", type=int, default=973)
    parser.add_argument("--supabase_creds", default=None)
    args = parser.parse_args()

    sb_creds = get_supabase_credentials(args.supabase_creds)
    generate_test_schedule(sb_creds, args.event_id, args.num_matches, args.seed)
