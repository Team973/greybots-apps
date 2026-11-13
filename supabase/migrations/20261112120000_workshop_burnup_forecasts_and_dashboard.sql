-- Workshop: burnup forecasts, and a dashboard of burnup charts.
--
-- Two forecasts on a burnup, each shown or hidden for everyone by a lead:
-- * The plan forecast: a lead's estimate of tickets closed and opened a week.
-- * The session forecast: the tickets closed and opened over the last N shop
--   sessions, carried forward over the sessions to come.
-- Milestones get them as new columns with defaults, so existing milestones
-- keep working (and get the session forecast, like the one-pace forecast they
-- had before).
--
-- The dashboard is a list of burnup charts that leads set up, each over the
-- tickets that match its filter (any of some milestones, and any of some
-- components; an empty list doesn't filter), with the same forecasts.

ALTER TABLE public."WorkshopMilestone"
    ADD COLUMN IF NOT EXISTS "forecast_plan_visible" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "forecast_plan_closed_per_week" numeric CHECK ("forecast_plan_closed_per_week" >= 0),
    ADD COLUMN IF NOT EXISTS "forecast_plan_opened_per_week" numeric NOT NULL DEFAULT 0 CHECK ("forecast_plan_opened_per_week" >= 0),
    ADD COLUMN IF NOT EXISTS "forecast_sessions_visible" boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "forecast_sessions" integer NOT NULL DEFAULT 4 CHECK ("forecast_sessions" BETWEEN 1 AND 52);

CREATE TABLE IF NOT EXISTS public."WorkshopDashboardChart" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" text NOT NULL CHECK (btrim("title") <> ''),
    "sort_order" double precision NOT NULL DEFAULT 0,
    -- The filter. Ids of deleted milestones or components just stop matching.
    "milestone_ids" uuid[] NOT NULL DEFAULT '{}',
    "component_ids" uuid[] NOT NULL DEFAULT '{}',
    "target_date" date,
    "forecast_plan_visible" boolean NOT NULL DEFAULT false,
    "forecast_plan_closed_per_week" numeric CHECK ("forecast_plan_closed_per_week" >= 0),
    "forecast_plan_opened_per_week" numeric NOT NULL DEFAULT 0 CHECK ("forecast_plan_opened_per_week" >= 0),
    "forecast_sessions_visible" boolean NOT NULL DEFAULT true,
    "forecast_sessions" integer NOT NULL DEFAULT 4 CHECK ("forecast_sessions" BETWEEN 1 AND 52),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_by" uuid DEFAULT auth.uid() REFERENCES public."User"("user_id") ON DELETE SET NULL
);

ALTER TABLE public."WorkshopDashboardChart" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."WorkshopDashboardChart" TO authenticated, service_role;

-- Everyone in Workshop sees the dashboard; leads and admins edit it.
CREATE POLICY "Enable read access for Workshop" ON public."WorkshopDashboardChart" FOR SELECT TO authenticated USING ((SELECT public.has_app_access('workshop')));
CREATE POLICY "Enable insert for leads and admins" ON public."WorkshopDashboardChart" FOR INSERT TO authenticated WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable update for leads and admins" ON public."WorkshopDashboardChart" FOR UPDATE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin')) WITH CHECK ((SELECT public.workshop_role()) IN ('lead', 'admin'));
CREATE POLICY "Enable delete for leads and admins" ON public."WorkshopDashboardChart" FOR DELETE TO authenticated USING ((SELECT public.workshop_role()) IN ('lead', 'admin'));
