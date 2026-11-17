import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from './db';
import type { Session } from './sessions';

// Checklists: lists of steps the team keeps as templates (pre-match checks,
// end-of-night teardown...), separate from tickets. Leads and admins add a
// copy of one to a shop session with an owner; its steps start out assigned
// to the owner, who can hand them to others. Steps are done in any order, and
// once they all are, the owner or an admin signs the checklist off.
//
// The rules live in the database (20261117120000_workshop_checklists.sql);
// the helpers here mirror them so the pages only offer what will be accepted.

export interface ChecklistTemplate {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    created_at: string;
    created_by: string | null;
    updated_at: string;
    updated_by: string | null;
}

export interface TemplateStep {
    id: string;
    template_id: string;
    title: string;
    details: string;
    sort_order: number;
}

// A step being written in the template editor.
export interface StepDraft {
    title: string;
    details: string;
}

export interface Checklist {
    id: string;
    template_id: string | null;
    session_id: string;
    name: string;
    description: string;
    owner_id: string | null;
    sort_order: number;
    signed_off_at: string | null;
    signed_off_by: string | null;
    created_at: string;
    created_by: string | null;
}

export interface ChecklistStep {
    id: string;
    checklist_id: string;
    title: string;
    details: string;
    sort_order: number;
    assignee_id: string | null;
    completed_at: string | null;
    completed_by: string | null;
}

// A checklist with its steps (in order), and the session it's on when that
// was asked for.
export interface FullChecklist extends Checklist {
    steps: ChecklistStep[];
    session?: Session | null;
}

// --- Templates ---

export async function fetchTemplates(): Promise<ChecklistTemplate[]> {
    return unwrap(await supabase.from('WorkshopChecklistTemplate').select('*').order('name')) as ChecklistTemplate[];
}

export async function fetchTemplate(id: string): Promise<{ template: ChecklistTemplate; steps: TemplateStep[] } | null> {
    const [template, steps] = await Promise.all([
        supabase.from('WorkshopChecklistTemplate').select('*').eq('id', id).maybeSingle(),
        supabase.from('WorkshopChecklistTemplateStep').select('*').eq('template_id', id).order('sort_order')
    ]);
    const found = unwrap(template) as ChecklistTemplate | null;
    return found ? { template: found, steps: unwrap(steps) as TemplateStep[] } : null;
}

// How many steps each template has, for the list.
export async function fetchTemplateStepCounts(): Promise<Map<string, number>> {
    const rows = unwrap(await supabase.from('WorkshopChecklistTemplateStep').select('template_id')) as { template_id: string }[];
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.template_id, (counts.get(row.template_id) ?? 0) + 1);
    return counts;
}

// Create a template (no id) or replace an existing one's name, description,
// and steps, all at once. Returns its id.
export async function saveTemplate(id: string | null, name: string, description: string, steps: StepDraft[]): Promise<string> {
    const cleaned = steps.map((s) => ({ title: s.title.trim(), details: s.details.trim() })).filter((s) => s.title || s.details);
    if (!name.trim()) throw new Error('Give the checklist a name.');
    if (cleaned.length === 0) throw new Error('A checklist needs at least one step.');
    if (cleaned.some((s) => !s.title)) throw new Error('Every step needs a title.');
    return unwrap(
        await supabase.rpc('workshop_save_checklist_template', { p_id: id, p_name: name.trim(), p_description: description.trim(), p_steps: cleaned })
    ) as string;
}

export async function setTemplateArchived(id: string, archived: boolean): Promise<void> {
    check(await supabase.from('WorkshopChecklistTemplate').update({ archived }).eq('id', id));
}

// --- Checklists on sessions ---

async function withSteps(checklists: Checklist[]): Promise<FullChecklist[]> {
    if (checklists.length === 0) return [];
    const steps = unwrap(
        await supabase
            .from('WorkshopChecklistStep')
            .select('*')
            .in(
                'checklist_id',
                checklists.map((c) => c.id)
            )
            .order('sort_order')
    ) as ChecklistStep[];
    return checklists.map((c) => ({ ...c, steps: steps.filter((s) => s.checklist_id === c.id) }));
}

async function withSessions(checklists: FullChecklist[]): Promise<FullChecklist[]> {
    const ids = [...new Set(checklists.map((c) => c.session_id))];
    if (ids.length === 0) return checklists;
    const sessions = unwrap(await supabase.from('WorkshopSession').select('*').in('id', ids)) as Session[];
    return checklists.map((c) => ({ ...c, session: sessions.find((s) => s.id === c.session_id) ?? null }));
}

export async function fetchSessionChecklists(sessionId: string): Promise<FullChecklist[]> {
    const rows = unwrap(await supabase.from('WorkshopChecklist').select('*').eq('session_id', sessionId).order('sort_order')) as Checklist[];
    return withSteps(rows);
}

export async function fetchChecklist(id: string): Promise<FullChecklist | null> {
    const row = unwrap(await supabase.from('WorkshopChecklist').select('*').eq('id', id).maybeSingle()) as Checklist | null;
    if (!row) return null;
    const [full] = await withSessions(await withSteps([row]));
    return full;
}

// Every checklist not signed off yet, with its session, soonest session first.
export async function fetchOpenChecklists(): Promise<FullChecklist[]> {
    const rows = unwrap(await supabase.from('WorkshopChecklist').select('*').is('signed_off_at', null)) as Checklist[];
    return sortBySession(await withSessions(await withSteps(rows)));
}

// The checklists with something for this person to do: a step of theirs not
// done yet, or (as the owner) one still to finish or sign off.
export async function fetchMyChecklists(userId: string): Promise<FullChecklist[]> {
    const [owned, assigned] = await Promise.all([
        supabase.from('WorkshopChecklist').select('id').eq('owner_id', userId).is('signed_off_at', null),
        supabase.from('WorkshopChecklistStep').select('checklist_id').eq('assignee_id', userId).is('completed_at', null)
    ]);
    const ids = new Set([
        ...(unwrap(owned) as { id: string }[]).map((r) => r.id),
        ...(unwrap(assigned) as { checklist_id: string }[]).map((r) => r.checklist_id)
    ]);
    if (ids.size === 0) return [];
    const rows = unwrap(await supabase.from('WorkshopChecklist').select('*').in('id', [...ids]).is('signed_off_at', null)) as Checklist[];
    return sortBySession(await withSessions(await withSteps(rows)));
}

function sortBySession(checklists: FullChecklist[]): FullChecklist[] {
    return checklists.sort(
        (a, b) => (a.session?.starts_at ?? '').localeCompare(b.session?.starts_at ?? '') || a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
}

// Leads and admins: add a copy of a template to a session.
export async function addChecklist(sessionId: string, templateId: string, ownerId: string): Promise<string> {
    return unwrap(await supabase.rpc('workshop_add_checklist', { p_session_id: sessionId, p_template_id: templateId, p_owner_id: ownerId })) as string;
}

// Leads and admins: take a checklist off its session (not once signed off).
export async function removeChecklist(id: string): Promise<void> {
    const removed = unwrap(await supabase.from('WorkshopChecklist').delete().eq('id', id).select('id')) as { id: string }[];
    if (removed.length === 0) throw new Error('That checklist is signed off; undo the sign-off to remove it.');
}

export async function setOwner(id: string, ownerId: string): Promise<void> {
    check(await supabase.from('WorkshopChecklist').update({ owner_id: ownerId }).eq('id', id));
}

// The database stamps the time and who did it.
export async function setSignedOff(id: string, signedOff: boolean): Promise<void> {
    check(await supabase.from('WorkshopChecklist').update({ signed_off_at: signedOff ? new Date().toISOString() : null }).eq('id', id));
}

export async function assignStep(stepId: string, assigneeId: string): Promise<void> {
    check(await supabase.from('WorkshopChecklistStep').update({ assignee_id: assigneeId }).eq('id', stepId));
}

// The database stamps the time and who did it.
export async function setStepDone(stepId: string, done: boolean): Promise<void> {
    check(await supabase.from('WorkshopChecklistStep').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', stepId));
}

// --- What the signed-in person may do (mirrors the database) ---

export interface Actor {
    userId: string | null;
    isMember: boolean;
    isLead: boolean;
    isAdmin: boolean;
}

// The owner or an admin: assigns steps, signs off, undoes the sign-off.
export const runsChecklist = (checklist: Checklist, actor: Actor) => actor.isAdmin || (!!actor.userId && checklist.owner_id === actor.userId);

export const canTick = (checklist: Checklist, step: ChecklistStep, actor: Actor) =>
    !checklist.signed_off_at && actor.isMember && (runsChecklist(checklist, actor) || (!!actor.userId && step.assignee_id === actor.userId));

export const canAssign = (checklist: Checklist, actor: Actor) => !checklist.signed_off_at && actor.isMember && runsChecklist(checklist, actor);

export const canChangeOwner = (checklist: Checklist, actor: Actor) => !checklist.signed_off_at && actor.isLead;

export const canRemove = (checklist: Checklist, actor: Actor) => !checklist.signed_off_at && actor.isLead;

// --- Progress ---

export function progress(checklist: FullChecklist): { done: number; total: number; complete: boolean } {
    const done = checklist.steps.filter((s) => s.completed_at).length;
    return { done, total: checklist.steps.length, complete: checklist.steps.length > 0 && done === checklist.steps.length };
}

// Steps assigned to this person that aren't done yet.
export const openStepsFor = (checklist: FullChecklist, userId: string | null) =>
    userId ? checklist.steps.filter((s) => s.assignee_id === userId && !s.completed_at) : [];
