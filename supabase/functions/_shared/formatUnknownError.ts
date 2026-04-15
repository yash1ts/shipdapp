/**
 * Edge-friendly string for catch blocks. PostgREST / Supabase errors are plain objects.
 */
export function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error === "string" && o.error) return o.error;
    if (typeof o.details === "string" && o.details) return o.details;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
