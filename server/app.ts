import './load-env.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

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
app.get('/api/health', (c) => c.json({ status: 'ok', service: 'licitaciones-api' }))

const CONVOCATORIAS_BASE = '/api/convocatorias-drive'
let convocatoriasRouterPromise: Promise<typeof import('./routes/convocatorias-drive.js')> | null = null

const convocatoriasLazy = new Hono()
convocatoriasLazy.all('/*', async (c) => {
  if (!convocatoriasRouterPromise) {
    convocatoriasRouterPromise = import('./routes/convocatorias-drive.js')
  }
  const { default: router } = await convocatoriasRouterPromise
  const url = new URL(c.req.url)
  if (url.pathname.startsWith(CONVOCATORIAS_BASE)) {
    url.pathname = url.pathname.slice(CONVOCATORIAS_BASE.length) || '/'
  }
  return router.fetch(new Request(url, c.req.raw), c.env, c.executionCtx)
})
app.route(CONVOCATORIAS_BASE, convocatoriasLazy)

app.notFound((c) => c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }, 404))
