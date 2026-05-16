/**
 * Catch-all Vercel: atiende /api/* (p. ej. /api/convocatorias-drive/browse).
 * api/index.ts solo respondía en /api exacto; por eso las carpetas quedaban en "Cargando…".
 */
import { handle } from 'hono/vercel'
import { app } from '../server/app.js'

/** Hobby: máx. 60 s por función; Pro permite hasta 300 s (Comparar largo). */
export const config = {
  maxDuration: 60,
  memory: 2048,
}

export default handle(app)
