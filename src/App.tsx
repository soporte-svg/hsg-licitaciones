import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SVGProps } from 'react'
import { apiJson, apiPdfBlob } from './api'
import { supabase } from './lib/supabase'
import { PageChrome } from './PageChrome'
import './index.css'

type BrowseItem =
  | { id: string; name: string; type: 'folder' }
  | { id: string; name: string; type: 'pdf' }

type Crumb = { id: string | null; name: string }

type AnalisisRecienteRow = {
  id: string
  folder_id: string
  conjunto: string
  servicio: string
  anio: number
  created_at: string
  top_3?: unknown
}

function normalizeName(n: string) {
  return n
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

function isTerminosName(name: string) {
  return normalizeName(name).includes('terminos')
}

/** Texto corto del 1º del top_3 guardado en BD (si existe). */
function resumenPrimerLugar(top3: unknown): string | null {
  if (!Array.isArray(top3) || top3.length === 0) return null
  const first = top3[0] as Record<string, unknown>
  const proveedor = first?.proveedor
  const puntaje = first?.puntaje
  if (typeof proveedor !== 'string' || !proveedor.trim()) return null
  if (typeof puntaje === 'number' && Number.isFinite(puntaje)) return `${proveedor} (${puntaje})`
  if (typeof puntaje === 'string' && puntaje.trim()) return `${proveedor} (${puntaje})`
  return proveedor
}

function isConfianza(x: string): x is 'alta' | 'media' | 'baja' {
  return x === 'alta' || x === 'media' || x === 'baja'
}

type FilaPropuesta = {
  proveedor?: string
  puntaje?: number
  justificacion?: string
  valores?: Record<string, unknown>
  extraccion?: {
    valores?: { criterio?: string; valor_ofertado?: string; confianza?: string; valor_numerico?: number | null }[]
    nit?: string | null
  }
}

type DocumentacionCelda = {
  requisito_id?: string
  proveedor?: string
  archivo?: string | null
  file_id?: string | null
  confianza?: string
  nota?: string
}

type ArchivoProveedorVista = { id: string; name: string }

type DocumentacionVista = {
  requisitos: { id: string; nombre: string; descripcion?: string; obligatorio?: boolean }[]
  archivos_por_proveedor: { proveedor: string; archivos: ArchivoProveedorVista[] }[]
  asignaciones: DocumentacionCelda[]
}

type CuadroTabId = 'resumen' | 'general' | 'evaluacion' | 'financiero' | 'documentacion'

function driveFileUrl(fileId: string) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

type AnalisisCriterioVista = {
  criterio: string
  cobertura_tr: string
  condiciones_tr: string
  especificidad?: string
  proveedores: { proveedor: string; puntaje_criterio: number; bullets: string[] }[]
}

type ExtendidoVista = {
  analisis_criterios: AnalisisCriterioVista[]
  financiero: {
    resumen: string
    comparativo: { concepto: string; valores_por_proveedor: Record<string, string> }[]
    analisis_propuesta_economica: string
  }
}

function IconMail(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function IconLock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}

function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function IconSpinner({ className, ...props }: SVGProps<SVGSVGElement>) {
  const cls = ['ui-spinner', className].filter(Boolean).join(' ')
  return (
    <svg
      className={cls}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="42" strokeDashoffset="12" />
    </svg>
  )
}

function InlineLoader({ label }: { label: string }) {
  return (
    <p className="inline-loader" role="status" aria-live="polite">
      <IconSpinner />
      <span>{label}</span>
    </p>
  )
}

function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="list list-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="list-skeleton__row" />
      ))}
    </ul>
  )
}

export default function App() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'Drive' }])
  const currentParentId = crumbs[crumbs.length - 1]?.id ?? null

  const [browseLoading, setBrowseLoading] = useState(false)
  const [folders, setFolders] = useState<BrowseItem[]>([])
  const [files, setFiles] = useState<BrowseItem[]>([])
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [asideFilter, setAsideFilter] = useState('')

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfTitle, setPdfTitle] = useState<string | null>(null)

  const [compararLoading, setCompararLoading] = useState(false)
  const [compararError, setCompararError] = useState<string | null>(null)
  const [compararResult, setCompararResult] = useState<Record<string, unknown> | null>(null)
  /** Fila completa desde GET /analisis/:id (historial). Si existe, el panel derecho prioriza esto sobre el último comparar. */
  const [analisisGuardado, setAnalisisGuardado] = useState<Record<string, unknown> | null>(null)
  const [historialSelectedId, setHistorialSelectedId] = useState<string | null>(null)
  const [historialDetalleLoading, setHistorialDetalleLoading] = useState(false)
  const [cuadroTab, setCuadroTab] = useState<CuadroTabId>('resumen')

  const [historial, setHistorial] = useState<
    { id: string; created_at: string; created_by: string; conjunto?: string; servicio?: string; anio?: number }[]
  >([])
  const [terminosEncontrado, setTerminosEncontrado] = useState<{ id: string; name: string } | null>(null)
  const [terminosCheckLoading, setTerminosCheckLoading] = useState(false)

  const [analisisRecientes, setAnalisisRecientes] = useState<AnalisisRecienteRow[]>([])
  const [analisisRecientesLoading, setAnalisisRecientesLoading] = useState(false)

  const browseGenRef = useRef(0)

  useEffect(() => {
    setCuadroTab('resumen')
  }, [historialSelectedId])

  const token = session?.access_token ?? ''

  useEffect(() => {
    setAsideFilter('')
  }, [currentParentId])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadBrowse = useCallback(async () => {
    if (!token) return
    const gen = ++browseGenRef.current
    setBrowseLoading(true)
    setBrowseError(null)
    try {
      const q = currentParentId ? `?parent_id=${encodeURIComponent(currentParentId)}` : ''
      const data = await apiJson<{ folders: BrowseItem[]; files: BrowseItem[] }>(
        `/api/convocatorias-drive/browse${q}`,
        token,
      )
      if (gen !== browseGenRef.current) return
      setFolders(data.folders ?? [])
      setFiles(data.files ?? [])
    } catch (e) {
      if (gen !== browseGenRef.current) return
      setFolders([])
      setFiles([])
      setBrowseError(e instanceof Error ? e.message : 'Error cargando carpetas')
    } finally {
      if (gen === browseGenRef.current) setBrowseLoading(false)
    }
  }, [token, currentParentId])

  useEffect(() => {
    void loadBrowse()
  }, [loadBrowse])

  const loadHistorial = useCallback(async () => {
    if (!token || !currentParentId) {
      setHistorial([])
      return
    }
    try {
      const res = await apiJson<{
        data:
          | {
              id: string
              created_at: string
              created_by: string
              conjunto?: string
              servicio?: string
              anio?: number
            }[]
          | null
        error: { message?: string } | null
      }>(`/api/convocatorias-drive/analisis?folder_id=${encodeURIComponent(currentParentId)}`, token)
      setHistorial(res.data ?? [])
    } catch {
      setHistorial([])
    }
  }, [token, currentParentId])

  const loadAnalisisRecientes = useCallback(async () => {
    if (!token) {
      setAnalisisRecientes([])
      return
    }
    setAnalisisRecientesLoading(true)
    try {
      const res = await apiJson<{ data: AnalisisRecienteRow[] | null; error: { message?: string } | null }>(
        `/api/convocatorias-drive/analisis-recientes?limit=40`,
        token,
      )
      setAnalisisRecientes(res.data ?? [])
    } catch {
      setAnalisisRecientes([])
    } finally {
      setAnalisisRecientesLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadHistorial()
  }, [loadHistorial])

  useEffect(() => {
    void loadAnalisisRecientes()
  }, [loadAnalisisRecientes])

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  useEffect(() => {
    if (!token || !currentParentId || folders.length === 0) {
      setTerminosEncontrado(null)
      return
    }
    let cancelled = false
    setTerminosCheckLoading(true)
    void apiJson<{ data: { id: string; name: string } | null; error: { message?: string } | null }>(
      `/api/convocatorias-drive/terminos?folder_id=${encodeURIComponent(currentParentId)}`,
      token,
    )
      .then((res) => {
        if (!cancelled) setTerminosEncontrado(res.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setTerminosEncontrado(null)
      })
      .finally(() => {
        if (!cancelled) setTerminosCheckLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, currentParentId, folders.length])

  const puedeComparar = useMemo(() => {
    if (!currentParentId) return false
    const hayProveedores = folders.length > 0
    return hayProveedores && Boolean(terminosEncontrado?.id)
  }, [currentParentId, folders.length, terminosEncontrado])

  const filteredFolders = useMemo(() => {
    const q = asideFilter.trim()
    if (!q) return folders
    const nq = normalizeName(q)
    return folders.filter((f) => normalizeName(f.name).includes(nq))
  }, [folders, asideFilter])

  const filteredFiles = useMemo(() => {
    const q = asideFilter.trim()
    if (!q) return files
    const nq = normalizeName(q)
    return files.filter((f) => normalizeName(f.name).includes(nq))
  }, [files, asideFilter])

  const analisisRecientesFiltrados = useMemo(() => {
    const q = asideFilter.trim()
    if (!q) return analisisRecientes
    const nq = normalizeName(q)
    return analisisRecientes.filter((r) =>
      normalizeName(`${r.servicio} ${r.conjunto} ${r.anio} ${r.folder_id}`).includes(nq),
    )
  }, [analisisRecientes, asideFilter])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setAuthError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setCrumbs([{ id: null, name: 'Drive' }])
    setCompararResult(null)
    setAnalisisGuardado(null)
    setHistorialSelectedId(null)
    setAnalisisRecientes([])
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
  }

  function clearPanelOnNavigate() {
    setCompararResult(null)
    setAnalisisGuardado(null)
    setHistorialSelectedId(null)
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
    setPdfTitle(null)
  }

  function enterFolder(f: BrowseItem) {
    if (f.type !== 'folder' || browseLoading) return
    const last = crumbs[crumbs.length - 1]
    if (last?.id === f.id) return
    clearPanelOnNavigate()
    setFolders([])
    setFiles([])
    setBrowseError(null)
    setCrumbs((c) => {
      const tail = c[c.length - 1]
      if (tail?.id === f.id) return c
      return [...c, { id: f.id, name: f.name }]
    })
  }

  function goCrumb(i: number) {
    if (i < 0 || i >= crumbs.length) return
    if (i === crumbs.length - 1 && !browseLoading) return
    clearPanelOnNavigate()
    setFolders([])
    setFiles([])
    setBrowseError(null)
    setCrumbs((c) => c.slice(0, i + 1))
  }

  async function openPdf(f: BrowseItem) {
    if (f.type !== 'pdf' || !token) return
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    try {
      const blob = await apiPdfBlob(`/api/convocatorias-drive/pdf?file_id=${encodeURIComponent(f.id)}`, token)
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      setPdfTitle(f.name)
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : 'No se pudo abrir el PDF')
    }
  }

  async function abrirAnalisisGuardado(id: string) {
    if (!token) return
    setHistorialSelectedId(id)
    setHistorialDetalleLoading(true)
    setCompararError(null)
    try {
      const res = await apiJson<{ data: Record<string, unknown> | null; error: { message?: string } | null }>(
        `/api/convocatorias-drive/analisis/${encodeURIComponent(id)}`,
        token,
      )
      if (!res.data) throw new Error(res.error?.message ?? 'Sin datos')
      setAnalisisGuardado(res.data)
    } catch (e) {
      setCompararError(e instanceof Error ? e.message : 'No se pudo cargar el análisis')
      setAnalisisGuardado(null)
    } finally {
      setHistorialDetalleLoading(false)
    }
  }

  function abrirConvocatoriaDesdeResumen(row: AnalisisRecienteRow) {
    if (!token || browseLoading) return
    const crumbName = row.servicio?.trim() || row.conjunto?.trim() || 'Servicio'
    setFolders([])
    setFiles([])
    setBrowseError(null)
    setCrumbs([{ id: null, name: 'Drive' }, { id: row.folder_id, name: crumbName }])
    clearPanelOnNavigate()
    void abrirAnalisisGuardado(row.id)
  }

  function volverAUltimoComparar() {
    setAnalisisGuardado(null)
    setHistorialSelectedId(null)
  }

  async function comparar() {
    if (!token || !currentParentId) return
    setCompararLoading(true)
    setCompararError(null)
    setCompararResult(null)
    try {
      const res = await apiJson<Record<string, unknown>>(`/api/convocatorias-drive/comparar`, token, {
        method: 'POST',
        body: JSON.stringify({ folder_id: currentParentId }),
      })
      setCompararResult(res)
      setCuadroTab('resumen')
      setAnalisisGuardado(null)
      setHistorialSelectedId(null)
      await loadHistorial()
      await loadAnalisisRecientes()
    } catch (e) {
      setCompararError(e instanceof Error ? e.message : 'Error al comparar')
    } finally {
      setCompararLoading(false)
    }
  }

  const vista = analisisGuardado ?? compararResult
  const top3 = (vista?.top_3 as { proveedor?: string; puntaje?: number; justificacion?: string }[]) ?? []
  const criterios = (vista?.criterios as { nombre?: string; peso?: number; descripcion?: string }[]) ?? []

  const todasProps: FilaPropuesta[] = useMemo(() => {
    if (analisisGuardado && Array.isArray(analisisGuardado.propuestas)) {
      return analisisGuardado.propuestas as FilaPropuesta[]
    }
    if (compararResult && Array.isArray(compararResult.propuestas)) {
      return compararResult.propuestas as FilaPropuesta[]
    }
    if (compararResult && Array.isArray(compararResult.todas_las_propuestas)) {
      return compararResult.todas_las_propuestas as FilaPropuesta[]
    }
    return []
  }, [analisisGuardado, compararResult])

  const documentacionVista = useMemo((): DocumentacionVista | null => {
    const raw = vista?.documentacion
    if (!raw || typeof raw !== 'object') return null
    const d = raw as Record<string, unknown>
    if (!Array.isArray(d.requisitos) || d.requisitos.length === 0) return null
    const rawArch = Array.isArray(d.archivos_por_proveedor) ? d.archivos_por_proveedor : []
    const archivos_por_proveedor = (rawArch as Record<string, unknown>[]).map((p) => {
      const proveedor = String(p.proveedor ?? '')
      const arr = Array.isArray(p.archivos) ? p.archivos : []
      const archivos: ArchivoProveedorVista[] = arr
        .map((x): ArchivoProveedorVista | null => {
          if (typeof x === 'string') return { id: '', name: x }
          const o = x as Record<string, unknown>
          const name = String(o.name ?? '')
          if (!name) return null
          return { id: String(o.id ?? ''), name }
        })
        .filter((x): x is ArchivoProveedorVista => x !== null)
      return { proveedor, archivos }
    })
    return {
      requisitos: d.requisitos as DocumentacionVista['requisitos'],
      archivos_por_proveedor,
      asignaciones: (Array.isArray(d.asignaciones) ? d.asignaciones : []) as DocumentacionVista['asignaciones'],
    }
  }, [vista])

  const extendidoVista = useMemo((): ExtendidoVista | null => {
    const raw = vista?.analisis_extendido
    if (!raw || typeof raw !== 'object') return null
    const e = raw as Record<string, unknown>
    const ac = Array.isArray(e.analisis_criterios) ? (e.analisis_criterios as AnalisisCriterioVista[]) : []
    const finRaw = e.financiero && typeof e.financiero === 'object' ? (e.financiero as Record<string, unknown>) : {}
    const comparativoRaw = Array.isArray(finRaw.comparativo) ? finRaw.comparativo : []
    const comparativo = comparativoRaw.map((row) => {
      const r = row as Record<string, unknown>
      const valores =
        r.valores_por_proveedor && typeof r.valores_por_proveedor === 'object'
          ? (r.valores_por_proveedor as Record<string, string>)
          : {}
      return { concepto: String(r.concepto ?? ''), valores_por_proveedor: valores }
    })
    const financiero = {
      resumen: String(finRaw.resumen ?? ''),
      comparativo,
      analisis_propuesta_economica: String(finRaw.analisis_propuesta_economica ?? ''),
    }
    if (ac.length === 0 && !financiero.resumen && comparativo.length === 0 && !financiero.analisis_propuesta_economica) {
      return null
    }
    return { analisis_criterios: ac, financiero }
  }, [vista])

  const proveedoresDocCols = useMemo(() => {
    if (documentacionVista?.archivos_por_proveedor?.length) {
      return documentacionVista.archivos_por_proveedor.map((p) => p.proveedor)
    }
    return todasProps.map((p) => p.proveedor).filter((x): x is string => Boolean(x))
  }, [documentacionVista, todasProps])

  const celdaDocLookup = useMemo(() => {
    const m = new Map<string, DocumentacionCelda>()
    for (const a of documentacionVista?.asignaciones ?? []) {
      if (!a.requisito_id || !a.proveedor) continue
      m.set(`${a.requisito_id}\0${a.proveedor}`, a)
    }
    return m
  }, [documentacionVista])

  const proveedoresFinCols = useMemo(() => {
    if (!extendidoVista) return []
    const s = new Set<string>()
    for (const row of extendidoVista.financiero.comparativo) {
      Object.keys(row.valores_por_proveedor).forEach((k) => s.add(k))
    }
    const base =
      proveedoresDocCols.length > 0
        ? proveedoresDocCols
        : (todasProps.map((p) => p.proveedor).filter((x): x is string => Boolean(x)) as string[])
    const ordered = base.filter((p) => s.has(p))
    const rest = [...s].filter((p) => !ordered.includes(p))
    return [...ordered, ...rest.sort((a, b) => a.localeCompare(b))]
  }, [extendidoVista, proveedoresDocCols, todasProps])

  if (authLoading) {
    return (
      <PageChrome>
        <div className="app-shell loading-center">
          <p className="muted">Cargando sesión…</p>
        </div>
      </PageChrome>
    )
  }

  if (!session) {
    return (
      <PageChrome>
        <div className="auth-wrap">
          <div className="auth-card">
            <div className="auth-card-brand">
              <img src="/image.png" alt="HSG 11 años" className="auth-card-logo" width={170} height={48} />
            </div>
            <h1 className="auth-card-headline">Qué bueno tenerte de vuelta</h1>
            <p className="auth-card-lead">Accede al cuadro comparativo de convocatorias (Drive + análisis).</p>
            <form onSubmit={handleLogin}>
              <label className="auth-field-label" htmlFor="auth-email">
                Email
              </label>
              <div className="auth-field">
                <span className="auth-field-icon">
                  <IconMail className="auth-field-svg" />
                </span>
                <input
                  id="auth-email"
                  type="email"
                  className="auth-field-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="tu@empresa.co"
                />
              </div>

              <label className="auth-field-label auth-field-label--spaced" htmlFor="auth-password">
                Contraseña
              </label>
              <div className="auth-field auth-field--password">
                <span className="auth-field-icon">
                  <IconLock className="auth-field-svg" />
                </span>
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-field-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <IconEyeOff className="auth-field-svg" /> : <IconEye className="auth-field-svg" />}
                </button>
              </div>

              {authError ? <p className="error">{authError}</p> : null}
              <button type="submit">Iniciar sesión</button>
            </form>
          </div>
        </div>
      </PageChrome>
    )
  }

  const analysisHeadline = vista
    ? [vista.servicio, vista.conjunto].filter(Boolean).map(String).join(' · ')
    : ''

  const sessionEmail = session.user?.email?.trim() ?? ''
  const userInitial =
    (
      sessionEmail.charAt(0) ||
      String(session.user?.user_metadata?.name ?? '?').trim().charAt(0) ||
      '?'
    ).toUpperCase()

  return (
    <PageChrome blur={false}>
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-header-inner">
            <div className="admin-header-logo-slot">
              <img src="/image.png" alt="HSG" className="admin-header-logo-img" width={170} height={52} />
            </div>
            <div className="admin-header-main">
              <div className="topbar-brand-text min-w-0 text-left">
                <p className="topbar-brand-kicker">Cuadros comparativos</p>
                <p className="topbar-brand-title">Convocatorias</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {sessionEmail ? (
                  <p className="hidden max-w-[12rem] truncate text-right font-mono text-xs font-medium text-slate-600 sm:block">
                    {sessionEmail}
                  </p>
                ) : null}
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.8125rem] font-bold text-accent shadow-[inset_0_0_0_1px_rgba(56,161,105,0.15)]"
                  title={sessionEmail || 'Usuario'}
                  aria-label={sessionEmail ? `Usuario: ${sessionEmail}` : 'Usuario'}
                >
                  {userInitial}
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold tracking-wide text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                  onClick={handleLogout}
                >
                  Salir
                </button>
              </div>
            </div>
          </div>
        </header>

        <aside className="admin-sidebar-wrap" aria-label="Origen en Drive">
            <div className="chrome-sidebar admin-sidebar-card">
            <div className="mb-3.5 shrink-0" role="search">
              <label className="sr-only" htmlFor="aside-filter">
                Filtrar proyectos y archivos por nombre
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400">
                  <IconSearch className="h-4 w-4" />
                </span>
                <input
                  id="aside-filter"
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={asideFilter}
                  onChange={(e) => setAsideFilter(e.target.value)}
                  placeholder="Buscar proyecto…"
                  className="w-full rounded-full border border-slate-200/90 bg-white py-2 pr-8 pl-9 text-[0.8125rem] text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-accent focus:ring-[3px] focus:ring-accent/15 focus:outline-none"
                />
                {asideFilter ? (
                  <button
                    type="button"
                    className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setAsideFilter('')}
                    aria-label="Limpiar búsqueda"
                  >
                    <span aria-hidden className="block px-0.5 text-[0.7rem] font-semibold">
                      ✕
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            <nav className="breadcrumbs chrome" aria-label="Ruta">
              {crumbs.map((c, i) => (
                <span key={`${c.id ?? 'root'}-${i}`}>
                  {i > 0 ? <span className="sep"> / </span> : null}
                  <button
                    type="button"
                    className="linkish"
                    disabled={browseLoading && i === crumbs.length - 1}
                    onClick={() => goCrumb(i)}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>

            <h2>Carpetas</h2>
            {browseLoading ? <InlineLoader label="Cargando carpetas…" /> : null}
            {browseError ? <p className="error">{browseError}</p> : null}
            {browseLoading ? (
              <ListSkeleton rows={8} />
            ) : (
              <ul className="list">
                {filteredFolders.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="row-btn"
                      disabled={browseLoading}
                      onClick={() => enterFolder(f)}
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!browseLoading && folders.length > 0 && filteredFolders.length === 0 ? (
              <p className="hint muted">Sin coincidencias en carpetas.</p>
            ) : null}

            <h3>PDFs</h3>
            {browseLoading ? (
              <ListSkeleton rows={3} />
            ) : (
              <ul className="list">
                {filteredFiles.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="row-btn"
                      disabled={browseLoading}
                      onClick={() => void openPdf(f)}
                    >
                      {f.name}
                      {f.type === 'pdf' && isTerminosName(f.name) ? (
                        <span className="badge">TR</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!browseLoading && files.length > 0 && filteredFiles.length === 0 ? (
              <p className="hint muted">Sin coincidencias en PDFs.</p>
            ) : null}

            {currentParentId ? (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!puedeComparar || compararLoading}
                  onClick={() => void comparar()}
                >
                  {compararLoading ? (
                    <span className="btn-loading">
                      <IconSpinner />
                      <span>Comparando…</span>
                    </span>
                  ) : (
                    'Comparar'
                  )}
                </button>
                {compararLoading ? (
                  <p className="hint muted">
                    2–8 min · no cierres esta pestaña
                  </p>
                ) : null}
                {!puedeComparar ? (
                  <p className="hint">
                    {terminosCheckLoading
                      ? 'TR…'
                      : folders.length === 0
                        ? 'Falta subcarpeta proveedor'
                        : 'Sin TR en carpeta central'}
                  </p>
                ) : terminosEncontrado ? (
                  <p className="hint muted" title={terminosEncontrado.name}>
                    TR vinculado
                  </p>
                ) : null}
              </div>
            ) : null}

            {historial.length > 0 ? (
              <>
                <h3>Historial</h3>
                {historialDetalleLoading ? <InlineLoader label="Cargando análisis…" /> : null}
                <ul className="list small">
                  {historial.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className={`historial-btn${historialSelectedId === h.id ? ' active' : ''}`}
                        onClick={() => void abrirAnalisisGuardado(h.id)}
                      >
                        {h.servicio ? `${h.servicio} · ` : null}
                        {new Date(h.created_at).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            </div>
        </aside>

        <main className="admin-main">
            <div className="analysis-stage analysis-stage--admin">
            {!currentParentId ? (
              <section className="recientes-resumen" aria-label="Convocatorias ya analizadas">
                <div className="recientes-resumen__head">
                  <h2 className="recientes-resumen__title">Ya analizadas</h2>
                  <p className="recientes-resumen__hint muted">Filtra con la búsqueda del panel izquierdo.</p>
                </div>
                {analisisRecientesLoading ? (
                  <InlineLoader label="Cargando análisis recientes…" />
                ) : null}
                {!analisisRecientesLoading && analisisRecientesFiltrados.length === 0 ? (
                  <p className="hint muted recientes-resumen__status">
                    {asideFilter.trim()
                      ? 'Ningún análisis coincide con la búsqueda.'
                      : 'Cuando compares una carpeta de servicio, aparecerá aquí para volver rápido.'}
                  </p>
                ) : null}
                {analisisRecientesFiltrados.length > 0 ? (
                  <ul className="recientes-list">
                    {analisisRecientesFiltrados.map((row) => {
                      const titulo =
                        [row.servicio, row.conjunto].filter((x) => String(x).trim()).join(' · ') || 'Convocatoria'
                      const primero = resumenPrimerLugar(row.top_3)
                      return (
                        <li key={row.id} className="recientes-list__item">
                          <button
                            type="button"
                            className="reciente-row"
                            disabled={browseLoading}
                            onClick={() => abrirConvocatoriaDesdeResumen(row)}
                            title="Abrir carpeta en Drive y ver este análisis"
                          >
                            <span className="reciente-row__title">{titulo}</span>
                            <span className="reciente-row__meta">
                              {row.anio ? `${row.anio} · ` : ''}
                              {new Date(row.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                              {primero ? ` · 1º ${primero}` : ''}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <p className="analysis-hero-label">Análisis</p>
            <h2 className="analysis-hero-title">
              {vista ? (analysisHeadline || 'Cuadro comparativo') : 'Cuadro comparativo'}
            </h2>

            {currentParentId && browseLoading ? (
              <InlineLoader label="Abriendo carpeta en Drive…" />
            ) : null}

            <p className="analysis-meta">
              {vista ? (
                <>
                  {analisisGuardado ? (
                    <>
                      <span className="badge">Histórico</span>{' '}
                      {compararResult ? (
                        <button type="button" className="linkish" onClick={volverAUltimoComparar}>
                          último comparar
                        </button>
                      ) : null}
                    </>
                  ) : compararResult ? (
                    <span className="badge">Nuevo</span>
                  ) : null}
                  <span style={{ marginLeft: '0.35rem' }}>
                    <code>{String(analisisGuardado ? analisisGuardado.id : compararResult?.analisis_id)}</code>
                  </span>
                </>
              ) : (
                <>Elige carpeta de servicio, Comparar u histórico</>
              )}
            </p>

            <details className="docs-collapsible">
              <summary>PDF opcional · {pdfTitle ?? 'sin selección'}</summary>
              {pdfUrl ? (
                <>
                  <p className="file-title muted">{pdfTitle}</p>
                  <iframe title="PDF" src={pdfUrl} className="pdf-frame" />
                </>
              ) : (
                <p className="file-title muted">Desde columna izquierda</p>
              )}
            </details>

            {compararError ? <p className="error">{compararError}</p> : null}

            {vista ? (
              <>
                <div className="cuadro-tabs" role="tablist" aria-label="Vistas del cuadro comparativo">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cuadroTab === 'resumen'}
                    className="cuadro-tab"
                    data-active={cuadroTab === 'resumen'}
                    onClick={() => setCuadroTab('resumen')}
                  >
                    Resumen
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cuadroTab === 'general'}
                    className="cuadro-tab"
                    data-active={cuadroTab === 'general'}
                    onClick={() => setCuadroTab('general')}
                  >
                    Análisis general
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cuadroTab === 'evaluacion'}
                    className="cuadro-tab"
                    data-active={cuadroTab === 'evaluacion'}
                    onClick={() => setCuadroTab('evaluacion')}
                  >
                    Criterios y ofertas
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cuadroTab === 'financiero'}
                    className="cuadro-tab"
                    data-active={cuadroTab === 'financiero'}
                    onClick={() => setCuadroTab('financiero')}
                  >
                    Propuesta financiera
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cuadroTab === 'documentacion'}
                    className="cuadro-tab"
                    data-active={cuadroTab === 'documentacion'}
                    onClick={() => setCuadroTab('documentacion')}
                  >
                    Documentación TR
                  </button>
                </div>

                {cuadroTab === 'resumen' ? (
                  <>
                    <h3>Top 3</h3>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Proveedor</th>
                          <th>Puntaje</th>
                          <th>Justificación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {top3.map((t, i) => (
                          <tr key={i}>
                            <td>{t.proveedor}</td>
                            <td>{t.puntaje}</td>
                            <td className="wrap">{t.justificacion}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {todasProps.length > 0 ? (
                      <>
                        <h3>Propuestas</h3>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Proveedor</th>
                              <th>Puntaje</th>
                              <th>Justificación</th>
                            </tr>
                          </thead>
                          <tbody>
                            {todasProps.map((p, i) => (
                              <tr key={i}>
                                <td>{p.proveedor}</td>
                                <td>{p.puntaje}</td>
                                <td className="wrap">{p.justificacion}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    ) : null}
                  </>
                ) : null}

                {cuadroTab === 'general' ? (
                  extendidoVista ? (
                    <>
                      <h3>Evaluación por criterio</h3>
                      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.85rem' }}>
                        Cobertura y condiciones según el TR; por cada proveedor, subpuntaje (0–10) y viñetas de
                        especificidad y cumplimiento.
                      </p>
                      <div className="analisis-criterios-stack">
                        {extendidoVista.analisis_criterios.map((bl, idx) => (
                          <article key={`${bl.criterio}-${idx}`} className="analisis-criterio-card">
                            <header className="analisis-criterio-card__head">
                              <h4 className="analisis-criterio-card__title">{bl.criterio}</h4>
                            </header>
                            <div className="analisis-criterio-card__tr">
                              <p>
                                <strong>Cobertura (TR)</strong>
                              </p>
                              <p className="muted analisis-criterio-card__text">{bl.cobertura_tr}</p>
                              <p>
                                <strong>Condiciones (TR)</strong>
                              </p>
                              <p className="muted analisis-criterio-card__text">{bl.condiciones_tr}</p>
                              {bl.especificidad ? (
                                <>
                                  <p>
                                    <strong>Especificidad</strong>
                                  </p>
                                  <p className="muted analisis-criterio-card__text">{bl.especificidad}</p>
                                </>
                              ) : null}
                            </div>
                            <ul className="analisis-criterio-proveedores">
                              {bl.proveedores.map((pr) => (
                                <li key={pr.proveedor} className="analisis-criterio-proveedor">
                                  <div className="analisis-criterio-proveedor__head">
                                    <span className="analisis-criterio-proveedor__name">{pr.proveedor}</span>
                                    <span className="analisis-criterio-proveedor__score">
                                      Puntaje criterio: <strong>{pr.puntaje_criterio}</strong> / 10
                                    </span>
                                  </div>
                                  <ul className="analisis-bullets">
                                    {pr.bullets.map((b, bi) => (
                                      <li key={bi}>{b}</li>
                                    ))}
                                  </ul>
                                </li>
                              ))}
                            </ul>
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                      No hay análisis general extendido para este resultado. Vuelve a ejecutar «Comparar» tras
                      actualizar el sistema, o el modelo no devolvió el bloque extendido.
                    </p>
                  )
                ) : null}

                {cuadroTab === 'financiero' ? (
                  extendidoVista ? (
                    <>
                      <h3>Comparativo de propuesta financiera</h3>
                      {extendidoVista.financiero.resumen ? (
                        <p className="analisis-fin-resumen">{extendidoVista.financiero.resumen}</p>
                      ) : null}
                      {extendidoVista.financiero.comparativo.length > 0 && proveedoresFinCols.length > 0 ? (
                        <div className="cuadro-table-scroll">
                          <table className="table table-doc-matrix">
                            <thead>
                              <tr>
                                <th className="table-doc-matrix__req">Concepto</th>
                                {proveedoresFinCols.map((prov) => (
                                  <th key={prov} className="table-doc-matrix__prov">
                                    {prov}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {extendidoVista.financiero.comparativo.map((row, ri) => (
                                <tr key={ri}>
                                  <td className="table-doc-matrix__req">
                                    <strong>{row.concepto}</strong>
                                  </td>
                                  {proveedoresFinCols.map((prov) => (
                                    <td key={prov} className="wrap table-doc-matrix__cell">
                                      {row.valores_por_proveedor[prov] ?? '—'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                          No se armó tabla comparativa financiera (puede no haber criterios tipo económico o faltan
                          valores extraídos).
                        </p>
                      )}
                      <h3 style={{ marginTop: '1.25rem' }}>Análisis de la propuesta económica</h3>
                      {extendidoVista.financiero.analisis_propuesta_economica ? (
                        <div className="analisis-fin-prosa">{extendidoVista.financiero.analisis_propuesta_economica}</div>
                      ) : (
                        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                          Sin texto extendido de propuesta económica.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                      No hay bloque financiero extendido. Ejecuta de nuevo «Comparar» o revisa que existan criterios
                      económicos en el TR.
                    </p>
                  )
                ) : null}

                {cuadroTab === 'evaluacion' ? (
                  <>
                    {criterios.length > 0 ? (
                      <>
                        <h3>Criterios (TR)</h3>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Criterio</th>
                              <th>Peso %</th>
                              <th>Desc.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {criterios.map((cr, i) => (
                              <tr key={i}>
                                <td>{cr.nombre}</td>
                                <td>{cr.peso}</td>
                                <td className="wrap">{cr.descripcion}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    ) : null}

                    {todasProps.length > 0 ? (
                      <>
                        <h3>Detalle por proveedor</h3>
                        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.65rem' }}>
                          Valores extraídos de los PDF de cada carpeta frente a los criterios del TR.
                        </p>
                        {todasProps.map((p, i) => {
                          const vals = p.extraccion?.valores
                          if (!vals?.length) {
                            return (
                              <div key={`ex-${i}`} className="extraccion-block extraccion-block--empty">
                                <h4>{p.proveedor}</h4>
                                <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
                                  Sin extracción (sin PDFs en la carpeta o no se pudo leer).
                                </p>
                              </div>
                            )
                          }
                          return (
                            <div key={`ex-${i}`} className="extraccion-block">
                              <h4>{p.proveedor}</h4>
                              <table className="table table-compact">
                                <thead>
                                  <tr>
                                    <th>Criterio</th>
                                    <th>Ofertado</th>
                                    <th>Conf.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {vals.map((v, j) => (
                                    <tr key={j}>
                                      <td>{v.criterio}</td>
                                      <td className="wrap">{v.valor_ofertado}</td>
                                      <td>
                                        {v.confianza && isConfianza(v.confianza) ? (
                                          <span className={`badge-conf ${v.confianza}`}>{v.confianza}</span>
                                        ) : (
                                          <span className="badge-conf baja">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        })}
                      </>
                    ) : null}
                  </>
                ) : null}

                {cuadroTab === 'documentacion' ? (
                  documentacionVista ? (
                    <>
                      <h3>Documentos exigidos vs archivos en carpeta</h3>
                      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.75rem' }}>
                        Se desglosan los documentos que el TR pide allegar y, por cada proveedor (subcarpeta), el nombre
                        de archivo que mejor encaja con ese requisito según la lista en Drive. Verificación automática;
                        conviene validar casos dudosos.
                      </p>
                      <div className="cuadro-table-scroll">
                        <table className="table table-doc-matrix">
                          <thead>
                            <tr>
                              <th className="table-doc-matrix__req">Requisito (TR)</th>
                              {proveedoresDocCols.map((prov) => (
                                <th key={prov} className="table-doc-matrix__prov">
                                  {prov}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {documentacionVista.requisitos.map((req) => (
                              <tr key={req.id}>
                                <td className="table-doc-matrix__req">
                                  <strong>{req.nombre}</strong>
                                  {req.obligatorio === false ? (
                                    <span className="badge" style={{ marginLeft: '0.35rem' }}>
                                      Opcional
                                    </span>
                                  ) : null}
                                  {req.descripcion ? (
                                    <p className="muted table-doc-matrix__desc">{req.descripcion}</p>
                                  ) : null}
                                </td>
                                {proveedoresDocCols.map((prov) => {
                                  const c = celdaDocLookup.get(`${req.id}\0${prov}`)
                                  return (
                                    <td key={prov} className="wrap table-doc-matrix__cell">
                                      {c?.archivo ? (
                                        c.file_id ? (
                                          <a
                                            href={driveFileUrl(c.file_id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="drive-doc-link"
                                          >
                                            <code className="table-doc-matrix__file">{c.archivo}</code>
                                            <span className="drive-doc-link__hint"> Abrir en Drive</span>
                                          </a>
                                        ) : (
                                          <code className="table-doc-matrix__file">{c.archivo}</code>
                                        )
                                      ) : (
                                        <span className="muted">—</span>
                                      )}
                                      {c?.confianza && isConfianza(c.confianza) ? (
                                        <span
                                          className={`doc-conf doc-conf--${c.confianza}`}
                                          title="Confianza del cruce automático"
                                        >
                                          {c.confianza}
                                        </span>
                                      ) : null}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <h3 style={{ marginTop: '1.25rem' }}>Archivos en carpeta (enlace a Drive)</h3>
                      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.65rem' }}>
                        Lista de archivos detectados por proveedor; abre el documento en Google Drive (requiere acceso
                        con tu cuenta).
                      </p>
                      <div className="drive-files-grid">
                        {documentacionVista.archivos_por_proveedor.map((p) => (
                          <div key={p.proveedor} className="drive-files-col">
                            <h4 className="drive-files-col__title">{p.proveedor}</h4>
                            {p.archivos.length === 0 ? (
                              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
                                Sin archivos
                              </p>
                            ) : (
                              <ul className="drive-files-list">
                                {p.archivos.map((f) => (
                                  <li key={`${p.proveedor}-${f.name}`}>
                                    {f.id ? (
                                      <a
                                        href={driveFileUrl(f.id)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="drive-doc-link drive-doc-link--inline"
                                      >
                                        {f.name}
                                      </a>
                                    ) : (
                                      <span className="muted">{f.name}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                      No hay datos de documentación para este análisis. Los análisis guardados antes de esta función no
                      incluyen el cruce; ejecuta de nuevo «Comparar» o el TR no arrojó una lista de documentos
                      allegables.
                    </p>
                  )
                ) : null}
              </>
            ) : (
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                Sin análisis. «Comparar» en carpeta de servicio o histórico.
              </p>
            )}
            </div>
          </main>
      </div>
    </PageChrome>
  )
}
