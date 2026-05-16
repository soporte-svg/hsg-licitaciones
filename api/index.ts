/**
 * Único handler serverless: todas las peticiones /api/* y /health se reenvían aquí vía vercel.json → routes.
 */
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

export const config = {
  maxDuration: 60,
  memory: 2048,
}

export default handle(app)
