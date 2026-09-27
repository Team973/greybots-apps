/**
 * Pick'em matchup engine (issue #68). Framework-free so the search logic can
 * be exercised directly; PickEmView.vue owns one of these per archetype
 * session and mirrors its state into refs.
 *
 * Two phases, same as before:
 *  - placing:  every unranked team is binary-searched into the ranked list
 *              by repeatedly asking "which would you rather have?".
 *  - refining: once everyone's ranked, keep comparing nearby pairs so the
 *              order can drift as more matches are scouted.
 *
 * What #68 adds on top:
 *  - Skip: throw away the current matchup and get two different teams. Both
 *    teams of a skipped matchup then sit out for SKIP_COOLDOWN_ROUNDS
 *    matchups (a skipped unranked team goes back to the end of the queue).
 *  - More shuffling: a plain binary search asks about one team ~6 times in a
 *    row, so instead CONCURRENT_PLACEMENTS searches run at once and each
 *    matchup is drawn from a randomly chosen one (never the team just shown,
 *    while there's another to choose). The reference team is also nudged away
 *    from recently shown / cooling teams, and the sides are randomly flipped.
 */

export type PickemPhase = 'placing' | 'refining' | 'insufficient';

export interface PickemDeps {
    /** The currently ranked teams, best first. Called fresh each time. */
    getRanked(): number[];
    /** Move/insert `team` so it ends up at `index` of the ranked order. */
    placeAt(team: number, index: number): void;
    /** Uniform random in [0, 1). */
    random(): number;
}

export interface PickemState {
    phase: PickemPhase;
    /** The team being placed (placing) or the upper-ranked team (refining). */
    candidate: number | null;
    /** The team it's being compared against. */
    opponent: number | null;
    /** Whether the UI should show `opponent` before `candidate` (random, for variety). */
    flip: boolean;
    placedCount: number;
    totalToPlace: number;
    refinementCount: number;
}

/** How many unranked teams are being binary-searched at once. */
export const CONCURRENT_PLACEMENTS = 3;
/** How many following matchups a skipped matchup's teams stay out of. */
export const SKIP_COOLDOWN_ROUNDS = 6;
/** How many recently shown teams (about three matchups) the reference pick steers away from. */
export const RECENT_TEAMS_MEMORY = 6;
/** Refinement pairs a team with one of its closest neighbors within this many ranks. */
export const REFINEMENT_WINDOW = 5;

interface Search {
    team: number;
    /** Lowest-ranked team the candidate is known to be worse than (null = none yet). */
    lowerTeam: number | null;
    /** Highest-ranked team the candidate is known to be better than (null = none yet). */
    upperTeam: number | null;
}

interface CurrentMatchup {
    search: Search | null;
    candidate: number;
    opponent: number;
    /** Refining only: ranked index of the upper team when the pair was shown. */
    upperIndex: number;
}

export function createPickemSession(deps: PickemDeps) {
    let phase: PickemPhase = 'placing';
    let queue: number[] = [];
    let searches: Search[] = [];
    let current: CurrentMatchup | null = null;
    let flip = false;

    let placedCount = 0;
    let totalToPlace = 0;
    let refinementCount = 0;

    // One "round" per matchup presented; cooldowns are expressed in rounds.
    let round = 0;
    const coolUntil = new Map<number, number>();
    let recent: number[] = [];
    let lastCandidate: number | null = null;
    let lastRefinementPair: [number, number] | null = null;

    const isCool = (team: number) => (coolUntil.get(team) ?? 0) > round;
    const randInt = (n: number) => Math.floor(deps.random() * n);
    const remember = (...teams: number[]) => { recent = [...recent, ...teams].slice(-RECENT_TEAMS_MEMORY); };
    const coolDown = (team: number) => { coolUntil.set(team, round + SKIP_COOLDOWN_ROUNDS + 1); };

    /**
     * The best non-empty subset of `items`: ones whose teams are neither
     * cooling down nor recently shown, else ones merely not cooling down,
     * else everything — so a small pool can never leave nothing to show.
     * Order is preserved.
     */
    function preferred<T>(items: T[], teamsOf: (item: T) => number[]): T[] {
        const clean = items.filter((it) => teamsOf(it).every((t) => !isCool(t) && !recent.includes(t)));
        if (clean.length > 0) return clean;
        const notCooling = items.filter((it) => teamsOf(it).every((t) => !isCool(t)));
        return notCooling.length > 0 ? notCooling : items;
    }

    // ─── Placing ──────────────────────────────────────────────────────────────

    /** [lo, hi) of ranked indexes the search still has to choose between. */
    function windowOf(search: Search, ranked: number[]): [number, number] {
        // Bounds are kept as teams, not indexes, so other searches inserting
        // teams into the ranked list meanwhile just widen the window.
        const lo = search.lowerTeam == null ? 0 : ranked.indexOf(search.lowerTeam) + 1;
        const hi = search.upperTeam == null ? ranked.length : ranked.indexOf(search.upperTeam);
        return [lo, hi];
    }

    /**
     * Ranked index to compare against: near the middle of the window (jittered
     * by up to ~30% of its width, so the same central teams don't anchor every
     * search, while keeping the search close to O(log n)), then nudged to the
     * closest team that isn't cooling down or recently shown.
     */
    function choosePivot(ranked: number[], lo: number, hi: number): number {
        const width = hi - lo;
        const trueMid = lo + (width >> 1);
        const jitter = width > 2 ? Math.round((deps.random() - 0.5) * width * 0.6) : 0;
        const target = Math.min(hi - 1, Math.max(lo, trueMid + jitter));

        const byDistance: number[] = [];
        for (let d = 0; d < width; d++) {
            if (target - d >= lo) byDistance.push(target - d);
            if (d > 0 && target + d < hi) byDistance.push(target + d);
        }
        return preferred(byDistance, (i) => [ranked[i]])[0];
    }

    /** Start searches from the queue, skipping over teams that are sitting out after a skip. */
    function refill() {
        while (searches.length < CONCURRENT_PLACEMENTS && queue.length > 0) {
            const idx = queue.findIndex((t) => !isCool(t));
            if (idx === -1) break;
            searches.push({ team: queue.splice(idx, 1)[0], lowerTeam: null, upperTeam: null });
        }
    }

    function finalize(search: Search, index: number) {
        deps.placeAt(search.team, index);
        searches = searches.filter((s) => s !== search);
        placedCount++;
    }

    function presentPlacing() {
        for (;;) {
            refill();
            if (searches.length === 0) {
                if (queue.length === 0) {
                    enterRefinement();
                    return;
                }
                // Everything left to place is sitting out after a skip. Rather
                // than show it right back, compare already-ranked teams until
                // its cooldown ends. (Safe: no placement is in progress, so no
                // search bounds can be disturbed by the reordering.)
                if (deps.getRanked().length >= 2) {
                    presentRefinement();
                    return;
                }
                // Too few ranked teams to compare anything else: show it anyway.
                searches.push({ team: queue.shift()!, lowerTeam: null, upperTeam: null });
            }

            const ranked = deps.getRanked();

            // Try the in-flight searches in random order, never leading with the
            // team just shown (while there's another), and prefer one whose
            // reference team isn't sitting out after a skip.
            const options = searches.length > 1 && lastCandidate != null
                ? searches.filter((s) => s.team !== lastCandidate)
                : [...searches];
            for (let i = options.length - 1; i > 0; i--) {
                const j = randInt(i + 1);
                [options[i], options[j]] = [options[j], options[i]];
            }

            let chosen: { search: Search; pivot: number } | null = null;
            let fallback: { search: Search; pivot: number } | null = null;
            let finalized = false;
            for (const search of options) {
                const [lo, hi] = windowOf(search, ranked);
                if (lo >= hi) {
                    // Nothing left to compare against (or it's the very first team): it belongs at lo.
                    finalize(search, lo);
                    finalized = true;
                    break;
                }
                const pivot = choosePivot(ranked, lo, hi);
                if (!isCool(ranked[pivot])) {
                    chosen = { search, pivot };
                    break;
                }
                if (!fallback) fallback = { search, pivot };
            }
            if (finalized) continue; // the ranked list changed; start over

            const pick = chosen ?? fallback!;
            current = { search: pick.search, candidate: pick.search.team, opponent: ranked[pick.pivot], upperIndex: -1 };
            flip = deps.random() < 0.5;
            return;
        }
    }

    // ─── Refining ─────────────────────────────────────────────────────────────

    function enterRefinement() {
        if (deps.getRanked().length < 2) {
            phase = 'insufficient';
            current = null;
            return;
        }
        phase = 'refining';
        presentRefinement();
    }

    // Nearby-but-not-strictly-adjacent pairing: only ever pairing true
    // neighbors leaves an anchor a single possible partner, so the same two
    // teams keep coming back around. A small window keeps comparisons
    // meaningful (close in rank) while giving each anchor several partners.
    function presentRefinement() {
        const flat = deps.getRanked();
        const n = flat.length;

        const anchors = preferred(Array.from({ length: n }, (_, i) => i), (i) => [flat[i]]);
        const anchor = anchors[randInt(anchors.length)];

        let partners: number[] = [];
        const maxWindow = Math.min(REFINEMENT_WINDOW, n - 1);
        for (let w = 1; w <= maxWindow; w++) {
            if (anchor - w >= 0) partners.push(anchor - w);
            if (anchor + w < n) partners.push(anchor + w);
        }

        // Don't immediately re-show the exact same pair, when there's a choice.
        if (lastRefinementPair) {
            const [a, b] = lastRefinementPair;
            const fresh = partners.filter((p) => {
                const upper = Math.min(anchor, p);
                const lower = Math.max(anchor, p);
                return !(flat[upper] === a && flat[lower] === b);
            });
            if (fresh.length > 0) partners = fresh;
        }

        partners = preferred(partners, (p) => [flat[p]]);
        const other = partners[randInt(partners.length)];
        const upperIndex = Math.min(anchor, other);
        const lowerIndex = Math.max(anchor, other);

        current = { search: null, candidate: flat[upperIndex], opponent: flat[lowerIndex], upperIndex };
        lastRefinementPair = [flat[upperIndex], flat[lowerIndex]];
        flip = deps.random() < 0.5;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    function advance() {
        round++;
        if (phase === 'placing') presentPlacing();
        else if (phase === 'refining') presentRefinement();
    }

    /** Begin a session over the given unranked teams (shuffled here). */
    function start(pool: number[]) {
        queue = [...pool];
        for (let i = queue.length - 1; i > 0; i--) {
            const j = randInt(i + 1);
            [queue[i], queue[j]] = [queue[j], queue[i]];
        }
        searches = [];
        current = null;
        coolUntil.clear();
        recent = [];
        lastCandidate = null;
        lastRefinementPair = null;
        round = 0;
        placedCount = 0;
        refinementCount = 0;
        totalToPlace = pool.length;
        phase = 'placing';
        advance();
    }

    /** The user picked `winner` (one of the two teams currently shown). */
    function choose(winner: number) {
        if (!current) return;
        const { search, candidate, opponent, upperIndex } = current;
        if (winner !== candidate && winner !== opponent) return;

        if (search) {
            if (winner === candidate) search.upperTeam = opponent;
            else search.lowerTeam = opponent;
            lastCandidate = candidate;
        } else {
            // A refinement pair (also used while placement waits out a skip):
            // if the lower-ranked team was preferred, swap it up.
            if (winner === opponent) deps.placeAt(opponent, upperIndex);
            refinementCount++;
        }
        remember(candidate, opponent);
        advance();
    }

    /**
     * Skip the current matchup: both teams sit out the next few matchups, and
     * two different teams are shown. A skipped unranked team is sent to the
     * back of the queue rather than dropped.
     */
    function skip() {
        if (!current) return;
        const { search, candidate, opponent } = current;

        coolDown(candidate);
        coolDown(opponent);
        remember(candidate, opponent);

        if (search) {
            searches = searches.filter((s) => s !== search);
            queue.push(search.team);
            lastCandidate = null;
        }
        advance();
    }

    function getState(): PickemState {
        return {
            phase,
            candidate: current?.candidate ?? null,
            opponent: current?.opponent ?? null,
            flip,
            placedCount,
            totalToPlace,
            refinementCount
        };
    }

    return { start, choose, skip, getState };
}

export type PickemSession = ReturnType<typeof createPickemSession>;
