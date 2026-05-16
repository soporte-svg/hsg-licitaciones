/** GET /api/health — comprobación sin pasar por el catch-all. */
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

export const config = {
  maxDuration: 10,
  memory: 1024,
}

export default handle(app)
