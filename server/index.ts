import './load-env.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import convocatoriasDriveRouter from './routes/convocatorias-drive.js'

const app = new Hono()

/** Render/Railway/Fly suelen inyectar PORT; en local usamos LICITACIONES_API_PORT. */
const port =
  Number(process.env.PORT?.trim()) ||
  Number(process.env.LICITACIONES_API_PORT?.trim()) ||
  3100

/** Orígenes permitidos (CORS). Separa varios con coma en LICITACIONES_WEB_ORIGIN. */
function allowedCorsOrigins(): string[] {
  const raw = process.env.LICITACIONES_WEB_ORIGIN?.trim()
  const fromList = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const defaults = ['http://localhost:5173', 'http://127.0.0.1:5173']
  if (fromList.length === 0 && !raw) {
    return defaults
  }
  return [...new Set([...fromList, ...defaults])]
}

const corsOrigins = allowedCorsOrigins()

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

serve({ fetch: app.fetch, port }, () => {
  console.log(`Licitaciones API en http://localhost:${port}`)
  console.log(`CORS orígenes: ${corsOrigins.join(', ')}`)
})
