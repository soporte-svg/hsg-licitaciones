/**
 * Entrada serverless de Vercel: mismo Hono que en local, sin proceso Node persistente.
 * Rutas: /health, /api/convocatorias-drive/*
 */
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

/** Comparar puede tardar varios minutos; requiere plan Vercel Pro (máx. 300 s). */
export const config = {
  maxDuration: 300,
  memory: 3008,
}

export default handle(app)
