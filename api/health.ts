import type { IncomingMessage, ServerResponse } from 'node:http'

/** Health sin dependencias: responde con Node req/res (compatible Vercel). */
export const config = {
  maxDuration: 10,
  memory: 256,
}

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ status: 'ok', service: 'licitaciones-api' }))
}
