import { createClient } from '@supabase/supabase-js'

/**
 * Admin client for seeder scripts. Uses the service role key, which bypasses RLS.
 * NEVER import this from Next.js app code — only from scripts/.
 */
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