import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL?.trim()
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY en licitaciones/.env (SUPABASE_URL y SUPABASE_ANON_KEY pueden venir de VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY; la service role debe definirse como SUPABASE_SERVICE_ROLE_KEY).',
  )
}

const realtimeForNode = {
  realtime: { transport: ws },
} as SupabaseClientOptions<'public'>

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, realtimeForNode)

export function supabaseForUser(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...realtimeForNode,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}
