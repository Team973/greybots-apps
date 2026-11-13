-- Workshop: the session forecast's open rate. The closure rate always comes
-- from the last N shop sessions; the rate tickets are opened (scope added) is
-- now either measured from the same sessions or set by a lead, per session.
-- By default it's set, at 0: only the closure rate is forecast, and the scope
-- line stays flat. Only new columns with defaults, on both tables that have
-- forecasts.

ALTER TABLE public."WorkshopMilestone"
    ADD COLUMN IF NOT EXISTS "forecast_sessions_opened_auto" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "forecast_sessions_opened_per_session" numeric NOT NULL DEFAULT 0 CHECK ("forecast_sessions_opened_per_session" >= 0);

ALTER TABLE public."WorkshopDashboardChart"
    ADD COLUMN IF NOT EXISTS "forecast_sessions_opened_auto" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "forecast_sessions_opened_per_session" numeric NOT NULL DEFAULT 0 CHECK ("forecast_sessions_opened_per_session" >= 0);
