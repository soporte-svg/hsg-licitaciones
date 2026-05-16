/** Base del API: en dev, vacío = rutas relativas /api/... (proxy en vite.config). En prod, URL absoluta del API desplegado. */
function apiBase(): string {
  const raw = import.meta.env.VITE_API_URL
  const b = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : ''
  if (b) return b
  if (import.meta.env.DEV) return ''
  throw new Error(
    'Falta VITE_API_URL en el build de Vercel. Añádela en Settings → Environment Variables (URL pública del API en Railway/Render, sin barra final) y vuelve a desplegar.',
  )
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
    `URL configurada: ${base}`,
    'Comprueba: (1) el API está desplegado y responde en /health, (2) VITE_API_URL en Vercel coincide con esa URL, (3) LICITACIONES_WEB_ORIGIN en el API incluye tu dominio de Vercel (ej. https://tu-app.vercel.app).',
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
    const url = `${apiBase()}/health`
    const res = await fetch(url)
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const j = (await res.json()) as { status?: string }
    return j.status === 'ok' ? { ok: true, detail: url } : { ok: false, detail: 'respuesta inesperada' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'error de red' }
  }
}
