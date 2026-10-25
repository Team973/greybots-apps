-- The team pick list becomes one ranked list with labelled dividers instead
-- of S-DNP tiers, like the spreadsheet the team used for the final pick list.
-- A row's dividers are [{ id, label, position }], where position is how many
-- ranked teams come before the divider. team_numbers then holds only the
-- ranked teams, in order, and team_tiers is left empty.
--
-- NULL means the row still uses tiers: every personal list, and any team
-- list saved before this change (the app turns its tiers into dividers the
-- next time a lead saves it).
ALTER TABLE public."PickList"
    ADD COLUMN IF NOT EXISTS "dividers" jsonb;

COMMENT ON COLUMN public."PickList"."dividers" IS 'Team lists only: [{id, label, position}] dividers in the ranked order. NULL for tier-based lists.';
