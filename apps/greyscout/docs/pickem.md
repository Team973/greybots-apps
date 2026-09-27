# Pick'em ([issue #68](https://github.com/Team973/greyscout/issues/68))

Pick'em builds your personal Pick List by showing two teams at a time and asking which you'd rather have. The winner is slotted into the ranking for you. It's on the **Alliance Selection → Pick'em** page (`/pickem`, members and up), with the same Scorer/Defender toggle as the Pick List.

## How matchups are chosen

- **Placing.** Each unranked team is binary-searched into your ranked list. A plain binary search asks about the same team about 6 times in a row, so up to 3 teams are searched at once and each matchup comes from a randomly chosen one, never the team you just saw (while there's another to choose). The team it's compared against is the middle of the remaining range, jittered, and nudged away from teams you've just seen. Placement still takes about the same number of comparisons as a plain binary search. The two teams are also shown in a random left/right order.
- **Refining.** Once everyone's ranked, Pick'em keeps comparing nearby pairs (within 5 ranks) so the order can drift as more matches are scouted. Anchors avoid recently seen teams, and the same pair is never shown back to back.

## Skipping a matchup

**Leads and admins** see a **Skip matchup** button under the two teams. Skipping shows two different teams, and both teams of the skipped matchup sit out for the next 6 matchups. A skipped unranked team goes to the back of the queue rather than being dropped; it isn't ranked until you've compared it. Skipping never changes your ranking. Members don't get the button.

Sitting out is best effort: if every alternative is also sitting out (very few teams left to place, or a long run of skips on a small list), a team can come back sooner. If the only teams left to place are sitting out, Pick'em shows comparisons between already-ranked teams until they're back.

## Source files

| File | Purpose |
|---|---|
| `src/views/PickEmView.vue` | The page: matchup UI, skip button, saving |
| `src/lib/pickem-session.ts` | The matchup engine (which two teams to show, how answers place teams, skip and sit-out logic). No Vue dependency. |
| `src/stores/picklist-store.ts` | `placeTeamAtFlatIndex`, which the engine calls to rank a team |
