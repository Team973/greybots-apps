// @ts-nocheck
import { supabase } from "@greybots/common/supabase/client";
import { strategyBoardTable } from "@/lib/constants";

// One StrategyBoard row per (event, match_number) — see
// supabase/migrations/20260828120000_add_strategyboard.sql. Returns
// { id: null, board: [], autoSelections: [] } when no board has been saved
// for this match yet, so callers can treat "not found" the same as "empty"
// without a special case.
export async function fetchStrategyBoard(eventId, matchNumber) {
    const { data, error } = await supabase
        .from(strategyBoardTable)
        .select("*")
        .eq("event", eventId)
        .eq("match_number", matchNumber)
        .maybeSingle();

    if (error) {
        console.error(error);
        return { id: null, board: [], autoSelections: [] };
    }

    if (!data) return { id: null, board: [], autoSelections: [] };

    return { id: data.id, board: data.board ?? [], autoSelections: data.auto_selections ?? [] };
}

// Saves which auto path (and side) each slot is planning to run for this
// match — [{ slot, autoPathId, side }], one entry per slot with a real
// (non-"None") selection. Upserted on (event, match_number) — see
// supabase/migrations/20260828120500_add_strategyboard_unique.sql — rather
// than tracking a row id, since this can be the first write for a match
// (before the whiteboard has created a StrategyBoard row) just as easily as
// StrategyBoard.vue's board strokes can be. Only auto_selections is in the
// payload, so an upsert's conflict path leaves board/scouted_by untouched.
export async function saveAutoSelections(eventId, matchNumber, autoSelections) {
    const { error } = await supabase
        .from(strategyBoardTable)
        .upsert(
            { event: eventId, match_number: matchNumber, auto_selections: autoSelections },
            { onConflict: "event,match_number" }
        );

    return error;
}
