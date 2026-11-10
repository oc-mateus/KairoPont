// Test-only replacement; production functions import the pinned Supabase SDK.
let context: unknown;
export function setContext(value: unknown) { context = value; }
export function createSupabaseContext(_req: Request, _options: unknown) { return Promise.resolve(context as any); }
