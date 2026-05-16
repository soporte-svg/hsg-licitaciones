import './load-env.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import convocatoriasDriveRouter from './routes/convocatorias-drive.js'

const app = new Hono()

const port = Number(process.env.LICITACIONES_API_PORT?.trim()) || 3100
const webOrigin = process.env.LICITACIONES_WEB_ORIGIN?.trim() || 'http://localhost:5173'

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: [webOrigin, 'http://127.0.0.1:5173'],
    credentials: true,
  }),
)

app.get('/health', (c) => c.json({ status: 'ok', service: 'licitaciones-api' }))

app.route('/api/convocatorias-drive', convocatoriasDriveRouter)

app.notFound((c) => c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }, 404))

serve({ fetch: app.fetch, port }, () => {
  console.log(`Licitaciones API en http://localhost:${port}`)
})
