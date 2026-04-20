import { createClient } from '@supabase/supabase-js'

// This client bypasses RLS. Use only in server-side scripts.
// NEVER import this in a client component or expose to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}