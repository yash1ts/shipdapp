import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function envPair(): { url: string; anonKey: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, anonKey };
}

export function supabaseEnvReady(): boolean {
  const { url, anonKey } = envPair();
  return Boolean(url && anonKey);
}

let cached: SupabaseClient | null = null;
let cacheKey = "";

/**
 * One client per browser context for anon + Edge Functions.
 * Avoids multiple GoTrueClient instances (e.g. React Strict Mode + repeated createClient calls).
 */
export function getBrowserSupabase(): SupabaseClient {
  const { url, anonKey } = envPair();
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  const sig = `${url}\0${anonKey}`;
  if (cached && cacheKey === sig) return cached;
  cached = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  cacheKey = sig;
  return cached;
}
