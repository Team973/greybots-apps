
// Site visibility
export const isSiteReadPrivate = true;
export const isSiteWritePrivate = true;

// Database tables
export const matchScoutTable = "MatchData";
export const pitScoutTable = "PitData";
export const preScoutTable = "PreScoutData";
export const preScoutCommentTable = "PreScoutComment";
export const eventInfoTable = "Event";
export const teamInfoTable = "Team";
export const matchScheduleTable = "Match";
export const robotPhotoTable = "RobotPhoto";
export const userTable = "User";
export const pickListTable = "PickList";
export const userProfileTable = "UserProfile";
export const autoPathTable = "AutoPath";
export const strategyBoardTable = "StrategyBoard";
export const watchlistTable = "Watchlist";
export const playoffsTable = "Playoffs";
export const playoffsPredictionTable = "PlayoffsPrediction";
export const scoutAssignmentTable = "ScoutAssignment";

// Picklist types
export const pickListTypePersonal = "personal";
export const pickListTypeTeam = "team";

// Picklist archetypes (issue #27) — a team can be ranked independently
// under either or both. Defense% threshold only pre-filters Pick'em's
// Defender candidate pool, it doesn't lock a team into one archetype.
export const defenseThresholdPercent = 50;

// Auto path alliance / starting side
export const allianceRed = "red";
export const allianceBlue = "blue";
export const sideLeft = "left";
export const sideRight = "right";

// Offline queue
export const offlineQueueKey = "greyscout_offline_queue";

// TBA integration
export const tbaProxyFunction = "tba-proxy";
export const tbaStatsCacheKey = "greyscout_tba_stats_cache";
export const tbaRankingsCacheKey = "greyscout_tba_rankings_cache";

// Database columns
export const teamNumberColumn = "prematch_team_number";
export const matchNumberColumn = "prematch_match_number";

// Match types a scouting entry can be for (MatchData.prematch_match_type).
// Practice and playoff matches reuse qualification match numbers, so the
// type is what tells them apart.
export const matchTypes = [
    { key: "practice", text: "Practice" },
    { key: "qual", text: "Qualification" },
    { key: "playoff", text: "Playoff" }
];
export const defaultMatchType = "qual";

// Storage buckets
export const robotPhotoBucket = "robot-photos";

// Default team number
export const defaultTeamNumber = 973;

// Event information.
export const defaultEventId = "2026cc";
// Flag to force override to the default event. Useful if you are playing two tournaments on the same day.
export const useDefaultEvent = true;


// View mode options.
export const minWidthForDesktop = 1000;