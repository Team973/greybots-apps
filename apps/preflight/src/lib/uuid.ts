// Name-based (RFC 4122 version 5) UUIDs: the same name always produces the
// same UUID. Used for rows that several devices may create independently
// (e.g. a TBA match imported on two tablets) so they converge on one row.

// Fixed namespace for Preflight names.
const namespace = 'a5f3c1e2-9b7d-4c6a-8e21-0f4d9b3a7c55';

function uuidToBytes(uuid: string): Uint8Array {
    return new Uint8Array((uuid.replace(/-/g, '').match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
}

export async function uuidFromName(name: string): Promise<string> {
    const nameBytes = new TextEncoder().encode(name);
    const input = new Uint8Array(16 + nameBytes.length);
    input.set(uuidToBytes(namespace));
    input.set(nameBytes, 16);

    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
    hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
