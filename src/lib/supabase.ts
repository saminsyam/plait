/**
 * Supabase client — backend plumbing, deliberately OUTSIDE src/engine (the
 * engine stays UI- and backend-free). Sushi 2.1 uses it for one thing: the
 * scan corpus (src/lib/scanCorpus.ts) that captures real engine traces for
 * offline prompt evals.
 *
 * Null-safe by design: when the EXPO_PUBLIC_SUPABASE_* env vars are absent the
 * client is null and every caller no-ops — the app runs exactly as it did
 * before Supabase existed. Nothing on the scan → picks critical path ever
 * waits on this module.
 *
 * Auth is one anonymous session (single user, pre-TestFlight), persisted via
 * AsyncStorage so the same auth.uid() survives restarts. RLS policies key on
 * it from day one, so adding real sign-in later is a dashboard change, not a
 * schema rethink. Enable "Anonymous sign-ins" in Supabase Auth settings.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Dot notation only — Expo inlines EXPO_PUBLIC_* at build time.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null | undefined;

/** The shared client, or null when Supabase isn't configured. */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  client =
    url && anonKey
      ? createClient(url, anonKey, {
          auth: {
            storage: AsyncStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
          },
        })
      : null;
  return client;
}

let signIn: Promise<boolean> | null = null;

/**
 * Resolve true once an (anonymous) session exists. Memoized so concurrent
 * writers share one sign-in; resolves false (never throws) when Supabase is
 * unconfigured or unreachable — callers just skip their write.
 */
export function ensureSignedIn(): Promise<boolean> {
  signIn ??= (async () => {
    const supabase = getSupabase();
    if (!supabase) return false;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) return true;
      const { error } = await supabase.auth.signInAnonymously();
      return !error;
    } catch {
      return false;
    }
  })();
  return signIn;
}
