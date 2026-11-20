import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from './db';

// Key milestones on the schedule ("Robot reveal", "Drive team practice"):
// dates leads and admins mark on the Sessions calendar. They sit in the
// calendar's all-day row next to the team's competition events, in their own
// colour. Just dates: ticket milestones (the Milestones page) are separate.

export interface KeyDate {
    id: string;
    title: string;
    // "YYYY-MM-DD", inclusive.
    start_date: string;
    end_date: string;
    notes: string;
}

export type KeyDateFields = Pick<KeyDate, 'title' | 'start_date' | 'end_date' | 'notes'>;

// Key dates overlapping [from, to) ("YYYY-MM-DD").
export async function fetchKeyDates(from: string, to: string): Promise<KeyDate[]> {
    return unwrap(
        await supabase.from('WorkshopKeyDate').select('id, title, start_date, end_date, notes').lt('start_date', to).gte('end_date', from).order('start_date')
    ) as KeyDate[];
}

function validate(fields: Partial<KeyDateFields>) {
    if (fields.title !== undefined && !fields.title.trim()) throw new Error('Give the milestone a name.');
    if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) throw new Error('The last day is before the first.');
}

export async function createKeyDate(fields: KeyDateFields): Promise<void> {
    validate(fields);
    check(await supabase.from('WorkshopKeyDate').insert(fields));
}

export async function updateKeyDate(id: string, changes: Partial<KeyDateFields>): Promise<void> {
    validate(changes);
    check(await supabase.from('WorkshopKeyDate').update(changes).eq('id', id));
}

export async function deleteKeyDate(id: string): Promise<void> {
    check(await supabase.from('WorkshopKeyDate').delete().eq('id', id));
}
