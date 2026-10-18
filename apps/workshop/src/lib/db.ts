// Supabase answers with { data, error }, and its errors are plain objects
// (not Error instances). These turn a failed call into a thrown Error with
// the database's message, which is what the pages show.

interface Result<T> {
    data: T | null;
    error: { message: string } | null;
}

export function unwrap<T>({ data, error }: Result<T>): T {
    if (error) throw new Error(error.message);
    return data as T;
}

export function check({ error }: { error: { message: string } | null }): void {
    if (error) throw new Error(error.message);
}

// The message to show for anything a page caught.
export function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
