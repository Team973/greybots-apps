import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from './db';

// GreyPoints: earned from completed tickets' bounties and team recognitions
// (and, once the attendance system is linked, hours in shop), and spent in
// the rewards marketplace. The ledger and its rules live in the database;
// see the Workshop migration.

export type AwardKind = 'ticket' | 'recognition' | 'attendance' | 'adjustment';
export type RecognitionLevel = 'shoutout' | 'recognition' | 'mvp';

export interface PointAward {
    id: string;
    user_id: string;
    points: number;
    kind: AwardKind;
    ticket_id: string | null;
    recognition_level: RecognitionLevel | null;
    note: string;
    awarded_by: string | null;
    awarded_at: string;
}

export interface PointBalance {
    user_id: string;
    name: string | null;
    // All time.
    earned: number;
    // This calendar year.
    season_earned: number;
    spent: number;
    balance: number;
}

export interface Reward {
    id: string;
    name: string;
    description: string;
    cost: number;
    stock: number | null;
    active: boolean;
    created_at: string;
}

export type RedemptionStatus = 'requested' | 'fulfilled' | 'cancelled';

export interface Redemption {
    id: string;
    reward_id: string | null;
    user_id: string;
    reward_name: string;
    cost: number;
    status: RedemptionStatus;
    requested_at: string;
    resolved_at: string | null;
    resolved_by: string | null;
}

// Fixed values per level (workshop_recognition_points() in the database).
export const recognitionLevels: { key: RecognitionLevel; label: string; points: number; hint: string }[] = [
    { key: 'shoutout', label: 'Shout-out', points: 10, hint: 'Went out of their way to help' },
    { key: 'recognition', label: 'Team recognition', points: 25, hint: 'Recognized in front of the team' },
    { key: 'mvp', label: 'MVP', points: 50, hint: 'An outstanding contribution' }
];

export const awardKindLabels: Record<AwardKind, string> = {
    ticket: 'Ticket',
    recognition: 'Recognition',
    attendance: 'Attendance',
    adjustment: 'Adjustment'
};

export function awardTitle(award: PointAward): string {
    if (award.kind === 'recognition') {
        const level = recognitionLevels.find((l) => l.key === award.recognition_level)?.label ?? 'Recognition';
        return award.note ? `${level}: ${award.note}` : level;
    }
    return award.note || awardKindLabels[award.kind];
}

export const redemptionStatusLabels: Record<RedemptionStatus, string> = {
    requested: 'Waiting to be handed over',
    fulfilled: 'Received',
    cancelled: 'Cancelled (points returned)'
};

// --- Balances and history ---

export async function fetchBalances(): Promise<PointBalance[]> {
    return unwrap(await supabase.from('WorkshopPointBalance').select('*')) as PointBalance[];
}

export async function fetchAwards(userId?: string, limit = 100): Promise<PointAward[]> {
    let query = supabase.from('WorkshopPointAward').select('*');
    if (userId) query = query.eq('user_id', userId);
    return unwrap(await query.order('awarded_at', { ascending: false }).limit(limit)) as PointAward[];
}

export async function fetchTicketAwards(ticketId: string): Promise<PointAward[]> {
    return unwrap(await supabase.from('WorkshopPointAward').select('*').eq('ticket_id', ticketId)) as PointAward[];
}

// Leads and admins; not to yourself.
export async function giveRecognition(userId: string, level: RecognitionLevel, note: string): Promise<void> {
    // The database sets the points from the level.
    check(await supabase.from('WorkshopPointAward').insert({ user_id: userId, kind: 'recognition', recognition_level: level, points: 1, note: note.trim() }));
}

// Admins: a correction, with the reason.
export async function adjustPoints(userId: string, points: number, note: string): Promise<void> {
    if (!Number.isInteger(points) || points === 0) throw new Error('Enter a whole number of points (negative to take some away).');
    if (!note.trim()) throw new Error('Say why the points are being adjusted.');
    check(await supabase.from('WorkshopPointAward').insert({ user_id: userId, kind: 'adjustment', points, note: note.trim() }));
}

// Admins: remove a recognition or adjustment made by mistake.
export async function deleteAward(id: string): Promise<void> {
    check(await supabase.from('WorkshopPointAward').delete().eq('id', id));
}

// --- Rewards ---

export async function fetchRewards(): Promise<Reward[]> {
    return unwrap(await supabase.from('WorkshopReward').select('*').order('cost')) as Reward[];
}

export async function saveReward(reward: Partial<Reward> & Pick<Reward, 'name' | 'cost'>): Promise<void> {
    if (!reward.name.trim()) throw new Error('Name the reward.');
    if (!Number.isInteger(reward.cost) || reward.cost <= 0) throw new Error('The cost has to be a whole number of points.');
    const fields = {
        name: reward.name.trim(),
        description: (reward.description ?? '').trim(),
        cost: reward.cost,
        stock: reward.stock ?? null,
        active: reward.active ?? true
    };
    if (reward.id) check(await supabase.from('WorkshopReward').update(fields).eq('id', reward.id));
    else check(await supabase.from('WorkshopReward').insert(fields));
}

export async function fetchRedemptions(userId?: string): Promise<Redemption[]> {
    let query = supabase.from('WorkshopRedemption').select('*');
    if (userId) query = query.eq('user_id', userId);
    return unwrap(await query.order('requested_at', { ascending: false })) as Redemption[];
}

export async function redeem(rewardId: string): Promise<Redemption> {
    return unwrap(await supabase.rpc('workshop_redeem_reward', { p_reward_id: rewardId })) as Redemption;
}

export async function resolveRedemption(id: string, status: Exclude<RedemptionStatus, 'requested'>): Promise<void> {
    check(await supabase.from('WorkshopRedemption').update({ status }).eq('id', id));
}
