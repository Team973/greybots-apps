import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from './db';
import { today } from './dates';

// Tickets: the shop's units of work. The rules about who can do what live in
// the database (enforce_workshop_ticket in the Workshop migration); the
// helpers here mirror them so the pages only offer what will be accepted.

export type TicketStatus = 'open' | 'in_progress' | 'closed';
export type CloseReason = 'complete' | 'duplicate' | 'wont_do';

export interface Ticket {
    id: string;
    number: number;
    title: string;
    description: string;
    milestone_id: string | null;
    component_ids: string[];
    owner_id: string | null;
    assignee_ids: string[];
    due_date: string | null;
    status: TicketStatus;
    close_reason: CloseReason | null;
    closed_at: string | null;
    closed_by: string | null;
    bounty: number | null;
    bounty_set_by: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// What a person fills in to open or edit a ticket.
export interface TicketDraft {
    title: string;
    description: string;
    milestone_id: string | null;
    component_ids: string[];
    owner_id: string | null;
    assignee_ids: string[];
    due_date: string | null;
    status: Exclude<TicketStatus, 'closed'>;
    bounty: number | null;
}

export const statusLabels: Record<TicketStatus, string> = {
    open: 'To do',
    in_progress: 'In progress',
    closed: 'Closed'
};

export const closeReasons: { key: CloseReason; label: string; hint: string }[] = [
    { key: 'complete', label: 'Complete', hint: 'The work is done. Pays out the bounty.' },
    { key: 'duplicate', label: 'Duplicate', hint: 'Another ticket covers it.' },
    { key: 'wont_do', label: "Won't do", hint: "It's not happening. No points." }
];

export const closeReasonLabels: Record<CloseReason, string> = {
    complete: 'Complete',
    duplicate: 'Duplicate',
    wont_do: "Won't do"
};

// The bounties a ticket can carry (workshop_bounty_options() in the
// database): bigger for harder or more urgent work.
export const bountyOptions: { points: number; label: string }[] = [
    { points: 5, label: 'Quick task' },
    { points: 10, label: 'Small' },
    { points: 25, label: 'Medium' },
    { points: 50, label: 'Large' },
    { points: 100, label: 'Huge' }
];

export function statusText(ticket: Pick<Ticket, 'status' | 'close_reason'>): string {
    return ticket.status === 'closed' && ticket.close_reason ? closeReasonLabels[ticket.close_reason] : statusLabels[ticket.status];
}

export function isOverdue(ticket: Pick<Ticket, 'status' | 'due_date'>): boolean {
    return ticket.status !== 'closed' && !!ticket.due_date && ticket.due_date < today();
}

// Owner or assignee: someone with a stake in the ticket.
export function isInterested(ticket: Pick<Ticket, 'owner_id' | 'assignee_ids'>, userId: string | null): boolean {
    return !!userId && (ticket.owner_id === userId || ticket.assignee_ids.includes(userId));
}

// Bounties are set by leads and admins who aren't the owner or an assignee.
export function canSetBounty(ticket: Pick<Ticket, 'owner_id' | 'assignee_ids'>, userId: string | null, isLead: boolean): boolean {
    return isLead && !isInterested(ticket, userId);
}

// How a bounty is shared out (workshop_bounty_split() in the database): the
// assignees split it equally, with any remainder going a point each to the
// first ones; an owner who isn't an assignee takes 10% (at least 1) off the
// top; with no assignees, the owner gets all of it.
export function bountySplit(bounty: number | null, ownerId: string | null, assigneeIds: string[]): { userId: string; points: number }[] {
    if (!bounty || bounty <= 0) return [];
    const assignees = [...new Set(assigneeIds)];
    if (assignees.length === 0) return ownerId ? [{ userId: ownerId, points: bounty }] : [];
    const shares: { userId: string; points: number }[] = [];
    let ownerShare = 0;
    if (ownerId && !assignees.includes(ownerId)) {
        ownerShare = Math.max(1, Math.floor(bounty / 10));
        shares.push({ userId: ownerId, points: ownerShare });
    }
    const rest = bounty - ownerShare;
    assignees.forEach((userId, i) => {
        const points = Math.floor(rest / assignees.length) + (i < rest % assignees.length ? 1 : 0);
        if (points > 0) shares.push({ userId, points });
    });
    return shares;
}

export function emptyDraft(): TicketDraft {
    return {
        title: '',
        description: '',
        milestone_id: null,
        component_ids: [],
        owner_id: null,
        assignee_ids: [],
        due_date: null,
        status: 'open',
        bounty: null
    };
}

export function draftOf(ticket: Ticket): TicketDraft {
    return {
        title: ticket.title,
        description: ticket.description,
        milestone_id: ticket.milestone_id,
        component_ids: [...ticket.component_ids],
        owner_id: ticket.owner_id,
        assignee_ids: [...ticket.assignee_ids],
        due_date: ticket.due_date,
        status: ticket.status === 'closed' ? 'open' : ticket.status,
        bounty: ticket.bounty
    };
}

// --- Reading ---

export interface TicketFilter {
    status?: 'active' | 'closed' | 'all';
    milestoneId?: string | null;
    // Owned by or assigned to this person.
    involving?: string;
}

export async function fetchTickets(filter: TicketFilter = {}): Promise<Ticket[]> {
    let query = supabase.from('WorkshopTicket').select('*');
    if (filter.status === 'active' || filter.status === undefined) query = query.neq('status', 'closed');
    else if (filter.status === 'closed') query = query.eq('status', 'closed');
    if (filter.milestoneId) query = query.eq('milestone_id', filter.milestoneId);
    if (filter.involving) query = query.or(`owner_id.eq.${filter.involving},assignee_ids.cs.{${filter.involving}}`);
    return unwrap(await query.order('number', { ascending: false })) as Ticket[];
}

export async function fetchTicketsByIds(ids: string[]): Promise<Ticket[]> {
    if (ids.length === 0) return [];
    return unwrap(await supabase.from('WorkshopTicket').select('*').in('id', ids)) as Ticket[];
}

export async function fetchTicket(number: number): Promise<Ticket | null> {
    return unwrap(await supabase.from('WorkshopTicket').select('*').eq('number', number).maybeSingle()) as Ticket | null;
}

// --- Writing ---

function fields(draft: TicketDraft) {
    return {
        title: draft.title.trim(),
        description: draft.description.trim(),
        milestone_id: draft.milestone_id || null,
        component_ids: draft.component_ids,
        owner_id: draft.owner_id || null,
        assignee_ids: draft.assignee_ids,
        due_date: draft.due_date || null,
        status: draft.status
    };
}

export async function createTicket(draft: TicketDraft): Promise<Ticket> {
    if (!draft.title.trim()) throw new Error('Give the ticket a title.');
    const row = { ...fields(draft), ...(draft.bounty ? { bounty: draft.bounty } : {}) };
    return unwrap(await supabase.from('WorkshopTicket').insert(row).select().single()) as Ticket;
}

// Saves what changed. The bounty is only sent when it changed, so someone who
// can't set it can still edit the rest. Returns the ticket as the database
// left it (which can have cleared the bounty).
export async function updateTicket(ticket: Ticket, draft: TicketDraft): Promise<Ticket> {
    if (!draft.title.trim()) throw new Error('Give the ticket a title.');
    const changes: Record<string, unknown> = fields(draft);
    if ((draft.bounty ?? null) !== ticket.bounty) changes.bounty = draft.bounty ?? null;
    return unwrap(await supabase.from('WorkshopTicket').update(changes).eq('id', ticket.id).select().single()) as Ticket;
}

export async function patchTicket(ticket: Ticket, changes: Partial<Pick<Ticket, 'status' | 'milestone_id' | 'bounty'>>): Promise<Ticket> {
    return unwrap(await supabase.from('WorkshopTicket').update(changes).eq('id', ticket.id).select().single()) as Ticket;
}

// Leads and admins only. A completed ticket pays out its bounty; `bounty`
// lets the closer settle it at the same time (when they're allowed to).
export async function closeTicket(ticket: Ticket, reason: CloseReason, bounty?: number | null): Promise<Ticket> {
    // (The database stamps when and by whom.)
    const changes: Record<string, unknown> = { status: 'closed', close_reason: reason };
    if (bounty !== undefined && bounty !== ticket.bounty) changes.bounty = bounty;
    return unwrap(await supabase.from('WorkshopTicket').update(changes).eq('id', ticket.id).select().single()) as Ticket;
}

// Leads and admins only. Takes back any points it paid out.
export async function reopenTicket(ticket: Ticket): Promise<Ticket> {
    return unwrap(await supabase.from('WorkshopTicket').update({ status: 'open' }).eq('id', ticket.id).select().single()) as Ticket;
}

export async function moveTickets(ids: string[], milestoneId: string | null): Promise<void> {
    if (ids.length === 0) return;
    check(await supabase.from('WorkshopTicket').update({ milestone_id: milestoneId }).in('id', ids));
}
