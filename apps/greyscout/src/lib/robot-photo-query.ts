// @ts-nocheck
import { supabase } from "@greybots/common/supabase/client";
import { robotPhotoTable } from "@/lib/constants";

// Single-team robot photo lookup — mirrors TeamAnalysisView's inline query
// but as a reusable helper. Never throws; returns null on any failure or
// absence so callers can fall back to the flat-color marker.
export async function fetchRobotPhotoUrl(teamNumber) {
    const { data, error } = await supabase
        .from(robotPhotoTable)
        .select("photo_url")
        .eq("team_number", teamNumber)
        .maybeSingle();

    if (error) {
        console.error(error);
        return null;
    }

    return data?.photo_url ?? null;
}
