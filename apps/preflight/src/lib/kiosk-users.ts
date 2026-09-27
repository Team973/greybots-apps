import { db, type KioskUser } from './db';
import { maxPinLength, minPinLength } from './constants';
import type { KioskRole } from './roles';

// Kiosk-mode accounts live only in this device's IndexedDB. PINs are salted
// and hashed with PBKDF2 so they aren't recoverable from a copied database.
// (A short numeric PIN is still brute-forceable offline; this is a
// convenience lock for a shared pit tablet, not strong security.)

const pbkdf2Iterations = 100_000;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
    return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
    return new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
}

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: pbkdf2Iterations },
        key,
        256
    );
    return toHex(bits);
}

export function validatePin(pin: string): string | null {
    if (!/^\d+$/.test(pin)) return 'PIN must be digits only';
    if (pin.length < minPinLength || pin.length > maxPinLength) {
        return `PIN must be ${minPinLength}-${maxPinLength} digits`;
    }
    return null;
}

export function listKioskUsers(): Promise<KioskUser[]> {
    return db.kioskUsers.orderBy('name').toArray();
}

export async function createKioskUser(name: string, role: KioskRole, pin: string): Promise<KioskUser> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name is required');
    const pinError = validatePin(pin);
    if (pinError) throw new Error(pinError);
    const clash = await db.kioskUsers.where('name').equalsIgnoreCase(trimmed).count();
    if (clash) throw new Error(`A user named "${trimmed}" already exists`);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const user: KioskUser = {
        id: crypto.randomUUID(),
        name: trimmed,
        role,
        pinSalt: toHex(salt),
        pinHash: await hashPin(pin, salt),
        createdAt: new Date().toISOString()
    };
    await db.kioskUsers.add(user);
    return user;
}

export async function verifyKioskPin(userId: string, pin: string): Promise<KioskUser | null> {
    const user = await db.kioskUsers.get(userId);
    if (!user) return null;
    const hash = await hashPin(pin, fromHex(user.pinSalt));
    return hash === user.pinHash ? user : null;
}

export async function setKioskPin(userId: string, pin: string): Promise<void> {
    const pinError = validatePin(pin);
    if (pinError) throw new Error(pinError);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await db.kioskUsers.update(userId, { pinSalt: toHex(salt), pinHash: await hashPin(pin, salt) });
}

export async function setKioskRole(userId: string, role: KioskRole): Promise<void> {
    await db.transaction('rw', db.kioskUsers, async () => {
        const user = await db.kioskUsers.get(userId);
        if (user?.role === 'admin' && role !== 'admin') await assertNotLastAdmin();
        await db.kioskUsers.update(userId, { role });
    });
}

export async function removeKioskUser(userId: string): Promise<void> {
    await db.transaction('rw', db.kioskUsers, async () => {
        const user = await db.kioskUsers.get(userId);
        if (user?.role === 'admin') await assertNotLastAdmin();
        await db.kioskUsers.delete(userId);
    });
}

async function assertNotLastAdmin() {
    const admins = await db.kioskUsers.filter((u) => u.role === 'admin').count();
    if (admins <= 1) throw new Error('The device needs at least one admin');
}
