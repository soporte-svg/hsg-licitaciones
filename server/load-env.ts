import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

config({ path: resolve(root, '.env') })

if (!process.env.SUPABASE_URL?.trim()) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL?.trim() ?? ''
}
if (!process.env.SUPABASE_ANON_KEY?.trim()) {
  process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
}

if (!process.env.LICITACIONES_WEB_ORIGIN?.trim() && process.env.LICITACIONES_FRONTEND_URL?.trim()) {
  process.env.LICITACIONES_WEB_ORIGIN = process.env.LICITACIONES_FRONTEND_URL.trim()
}

const drivePath = process.env.DRIVE_CREDENTIALS_JSON?.trim()
if (drivePath && !isAbsolute(drivePath)) {
  process.env.DRIVE_CREDENTIALS_JSON = resolve(root, drivePath)
}
