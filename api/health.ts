/** Health check ligero: sin Hono, Drive ni Supabase (evita cold start de 60s en Vercel). */
export const config = {
  maxDuration: 10,
  memory: 256,
}

export default function handler() {
  return new Response(JSON.stringify({ status: 'ok', service: 'licitaciones-api' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
