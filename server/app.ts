import './load-env.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import convocatoriasDriveRouter from './routes/convocatorias-drive.js'

/** Orígenes permitidos (CORS). Separa varios con coma en LICITACIONES_WEB_ORIGIN. */
export function allowedCorsOrigins(): string[] {
  const raw = process.env.LICITACIONES_WEB_ORIGIN?.trim()
  const fromList = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const defaults = ['http://localhost:5173', 'http://127.0.0.1:5173']
  const vercel: string[] = []
  if (process.env.VERCEL_URL?.trim()) {
    vercel.push(`https://${process.env.VERCEL_URL.trim()}`)
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    vercel.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`)
  }
  const merged = [...fromList, ...vercel, ...defaults]
  if (merged.length === 0) return defaults
  return [...new Set(merged)]
}

const corsOrigins = allowedCorsOrigins()

export const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return corsOrigins[0] ?? 'http://localhost:5173'
      if (corsOrigins.includes(origin)) return origin
      return corsOrigins[0] ?? 'http://localhost:5173'
    },
    credentials: true,
  }),
)

app.get('/health', (c) => c.json({ status: 'ok', service: 'licitaciones-api' }))

app.route('/api/convocatorias-drive', convocatoriasDriveRouter)

app.notFound((c) => c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }, 404))
