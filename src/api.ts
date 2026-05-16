/** Base del API: en dev, vacío = rutas relativas /api/... (proxy en vite.config). En prod, URL absoluta. */
function apiBase(): string {
  const raw = import.meta.env.VITE_API_URL
  const b = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : ''
  if (b) return b
  if (import.meta.env.DEV) return ''
  throw new Error('En producción configura VITE_API_URL con la URL pública del API.')
}

function apiUrl(path: string): string {
  const base = apiBase()
  if (!path.startsWith('/')) return `${base}/${path}`
  return base ? `${base}${path}` : path
}

function fetchFailedMessage(): string {
  const hint = import.meta.env.DEV
    ? ' ¿Está el API en marcha? Ejecuta npm run dev en la carpeta licitaciones.'
    : ''
  return `No se pudo conectar con el servidor.${hint}`
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
  } catch {
    throw new Error(fetchFailedMessage())
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
  } catch {
    throw new Error(fetchFailedMessage())
  }
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 300) || `Error ${res.status}`)
  }
  return res.blob()
}
