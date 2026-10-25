-- Team numbers become text. Offseason events can field a second robot as a
-- "B" team (e.g. 973B, which TBA keys as "frc973B"), and every team number
-- column was a smallint, so a B team's schedule slot was stored as NULL and
-- its scouting data couldn't be saved at all.
--
-- Existing numbers convert as-is (973 -> '973'). Nothing references these
-- columns from a view, policy, trigger, or foreign key; the unique indexes
-- on them (Watchlist, RobotPhoto, AutoPath, PreScout*) are rebuilt by the
-- type change. MatchData2025 and MatchDataUploaded2025 are already text.
--
-- Roll out in this order: the app first (it reads both numbers and text),
-- then this migration, then the tba-proxy function and the nightly util job,
-- which write text from then on.

ALTER TABLE public."Team" ALTER COLUMN "team_number" TYPE text USING "team_number"::text;

ALTER TABLE public."Match"
    ALTER COLUMN "red1" TYPE text USING "red1"::text,
    ALTER COLUMN "red2" TYPE text USING "red2"::text,
    ALTER COLUMN "red3" TYPE text USING "red3"::text,
    ALTER COLUMN "blue1" TYPE text USING "blue1"::text,
    ALTER COLUMN "blue2" TYPE text USING "blue2"::text,
    ALTER COLUMN "blue3" TYPE text USING "blue3"::text;

ALTER TABLE public."MatchData" ALTER COLUMN "prematch_team_number" TYPE text USING "prematch_team_number"::text;
ALTER TABLE public."PitData" ALTER COLUMN "pit_team_number" TYPE text USING "pit_team_number"::text;
ALTER TABLE public."PreScoutData" ALTER COLUMN "prescout_team_number" TYPE text USING "prescout_team_number"::text;
ALTER TABLE public."PreScoutComment" ALTER COLUMN "prescout_team_number" TYPE text USING "prescout_team_number"::text;
ALTER TABLE public."AutoPath" ALTER COLUMN "team_number" TYPE text USING "team_number"::text;
ALTER TABLE public."Watchlist" ALTER COLUMN "team_number" TYPE text USING "team_number"::text;
ALTER TABLE public."RobotPhoto" ALTER COLUMN "team_number" TYPE text USING "team_number"::text;

-- The integer[] defaults can't be cast in place, so they're reset around
-- the type change.
ALTER TABLE public."PickList"
    ALTER COLUMN "team_numbers" DROP DEFAULT,
    ALTER COLUMN "picked_team_numbers" DROP DEFAULT;
ALTER TABLE public."PickList"
    ALTER COLUMN "team_numbers" TYPE text[] USING "team_numbers"::text[],
    ALTER COLUMN "picked_team_numbers" TYPE text[] USING "picked_team_numbers"::text[];
ALTER TABLE public."PickList"
    ALTER COLUMN "team_numbers" SET DEFAULT '{}'::text[],
    ALTER COLUMN "picked_team_numbers" SET DEFAULT '{}'::text[];
