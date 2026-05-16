/**
 * Entrada serverless de Vercel: mismo Hono que en local, sin proceso Node persistente.
 * Rutas: /health, /api/convocatorias-drive/*
 */
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

/** Comparar puede tardar varios minutos; maxDuration 300 requiere Vercel Pro. Hobby: máx. 2048 MB RAM. */
export const config = {
  maxDuration: 300,
  memory: 2048,
}

export default handle(app)
