import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.warn(
    '[licitaciones] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY (copia desde hsg-portal/apps/web).',
  )
}

export const supabase = createClient(url ?? '', anon ?? '')
