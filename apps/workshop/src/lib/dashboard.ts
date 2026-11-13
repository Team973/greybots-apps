import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from './db';
import { forecastFields, type ForecastColumns } from './milestones';
import type { Ticket } from './tickets';

// The dashboard: burnup charts leads set up, each over the tickets that match
// its filter. A ticket matches when it's in any of the chart's milestones and
// tagged with any of its components; an empty list doesn't filter, so a chart
// with neither covers every ticket. Everyone sees the dashboard; leads and
// admins edit it (RLS in the database).

export interface DashboardChart extends ForecastColumns {
    id: string;
    title: string;
    sort_order: number;
    milestone_ids: string[];
    component_ids: string[];
    target_date: string | null;
    created_at: string;
}

export type ChartDraft = Pick<DashboardChart, 'title' | 'milestone_ids' | 'component_ids' | 'target_date'> & ForecastColumns;

export function chartTickets(tickets: Ticket[], chart: Pick<DashboardChart, 'milestone_ids' | 'component_ids'>): Ticket[] {
    return tickets.filter(
        (t) =>
            (chart.milestone_ids.length === 0 || (!!t.milestone_id && chart.milestone_ids.includes(t.milestone_id))) &&
            (chart.component_ids.length === 0 || t.component_ids.some((c) => chart.component_ids.includes(c)))
    );
}

export async function fetchCharts(): Promise<DashboardChart[]> {
    return unwrap(await supabase.from('WorkshopDashboardChart').select('*').order('sort_order').order('created_at')) as DashboardChart[];
}

function fields(chart: ChartDraft) {
    return {
        title: chart.title.trim(),
        milestone_ids: chart.milestone_ids,
        component_ids: chart.component_ids,
        target_date: chart.target_date || null,
        ...forecastFields(chart)
    };
}

// New charts go at the bottom.
export async function addChart(chart: ChartDraft, after: number): Promise<void> {
    check(await supabase.from('WorkshopDashboardChart').insert({ ...fields(chart), sort_order: after + 1 }));
}

export async function updateChart(id: string, chart: ChartDraft): Promise<void> {
    check(await supabase.from('WorkshopDashboardChart').update(fields(chart)).eq('id', id));
}

export async function deleteChart(id: string): Promise<void> {
    check(await supabase.from('WorkshopDashboardChart').delete().eq('id', id));
}

// Saves the order the charts are in.
export async function reorderCharts(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id, i) => supabase.from('WorkshopDashboardChart').update({ sort_order: i + 1 }).eq('id', id).then(check)));
}
