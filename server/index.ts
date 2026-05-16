import { serve } from '@hono/node-server'
import { allowedCorsOrigins, app } from './app.js'

/** Render/Railway/Fly suelen inyectar PORT; en local usamos LICITACIONES_API_PORT. */
const port =
  Number(process.env.PORT?.trim()) ||
  Number(process.env.LICITACIONES_API_PORT?.trim()) ||
  3100

serve({ fetch: app.fetch, port }, () => {
  console.log(`Licitaciones API en http://localhost:${port}`)
  console.log(`CORS orígenes: ${allowedCorsOrigins().join(', ')}`)
})
