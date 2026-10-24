-- Scouts can flag really good defense: "amazing" joins the defense impact
-- choices, above "good". Existing rows already satisfy the wider check.
ALTER TABLE public."MatchData"
    DROP CONSTRAINT IF EXISTS "MatchData_defense_impact_check";

ALTER TABLE public."MatchData"
    ADD CONSTRAINT "MatchData_defense_impact_check" CHECK (
        "postmatch_defense_impact" IS NULL
        OR "postmatch_defense_impact" = ANY (ARRAY['none', 'amazing', 'good', 'minimal', 'ineffective'])
    );
