/**
 * Base del API.
 * - Dev: vacío → proxy Vite `/api` → localhost:3100
 * - Vercel (monolito): vacío → mismo origen (`/api/...` en hsg-licitaciones.vercel.app)
 * - API externo: `VITE_API_URL=https://tu-api.onrender.com`
 */
function apiBase(): string {
  const raw = import.meta.env.VITE_API_URL
  const b = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : ''
  if (b) return b
  if (import.meta.env.DEV) return ''
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

function apiUrl(path: string): string {
  const base = apiBase()
  if (!path.startsWith('/')) return `${base}/${path}`
  return base ? `${base}${path}` : path
}

function fetchFailedMessage(cause?: unknown): string {
  if (import.meta.env.DEV) {
    return 'No se pudo conectar con el servidor. ¿Está el API en marcha? Ejecuta npm run dev en la carpeta licitaciones.'
  }
  const base = (() => {
    try {
      return apiBase()
    } catch {
      return '(VITE_API_URL no configurada)'
    }
  })()
  const lines = [
    'No se pudo conectar con el API.',
    `URL: ${base}`,
    'Comprueba /health en el mismo dominio. En Vercel monolito no hace falta VITE_API_URL. Si el API está en otro host, define VITE_API_URL y redeploy.',
  ]
  if (cause instanceof Error && cause.message && !cause.message.includes('No se pudo')) {
    lines.push(`Detalle: ${cause.message}`)
  }
  return lines.join(' ')
}

export async function apiJson<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (e) {
    throw new Error(fetchFailedMessage(e))
  }
  const text = await res.text()
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
    throw new Error(
      'El servidor devolvió HTML en lugar de JSON (suele ser un fallo de rutas en Vercel). Comprueba /api/health y que exista api/[[...route]].ts.',
    )
  }
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Respuesta no JSON (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string } }
    const msg =
      err?.error?.message ??
      (typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : null)
    throw new Error(msg ?? `Error HTTP ${res.status}`)
  }
  return data as T
}

export async function apiPdfBlob(path: string, token: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (e) {
    throw new Error(fetchFailedMessage(e))
  }
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 300) || `Error ${res.status}`)
  }
  return res.blob()
}

/** Comprueba que el API responde (sin auth). Útil en diagnóstico de despliegue. */
export async function pingApiHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const url = `${apiBase()}/api/health`
    const res = await fetch(url)
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const j = (await res.json()) as { status?: string }
    return j.status === 'ok' ? { ok: true, detail: url } : { ok: false, detail: 'respuesta inesperada' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'error de red' }
  }
}
