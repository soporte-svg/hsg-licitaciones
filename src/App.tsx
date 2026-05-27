import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SVGProps } from 'react'
import { ApiError, apiJson, apiPdfBlob } from './api'
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

type FuenteTerminos = 'drive' | 'texto' | 'manual'

type CriterioManual = {
  nombre: string
  descripcion: string
  peso: number
  tipo: 'economico' | 'tecnico' | 'experiencia' | 'juridico'
  unidad: string
}

const CRITERIO_VACIO: CriterioManual = {
  nombre: '',
  descripcion: '',
  peso: 0,
  tipo: 'tecnico',
  unidad: '',
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

type ResumenCriterioFila = {
  criterio: string
  peso_pct: number
  medicion_tr: string
  valor_ofertado: string
  confianza_extraccion?: string | null
  subpuntaje_10: number
  hallazgo: string
}

type ResumenProveedorVista = {
  proveedor: string
  puntaje_global?: number | null
  veredicto: string
  por_criterio: ResumenCriterioFila[]
}

type ResumenEjecutivoVista = {
  sintesis_global: string
  proveedores: ResumenProveedorVista[]
}

type AnalisisCriterioVista = {
  criterio: string
  medicion_tr?: string
  peso_pct?: number
  tipo_criterio?: string
  cobertura_tr: string
  condiciones_tr: string
  especificidad?: string
  proveedores: {
    proveedor: string
    puntaje_criterio: number
    valor_ofertado?: string
    confianza_extraccion?: string | null
    bullets: string[]
  }[]
}

type ExtendidoVista = {
  resumen_ejecutivo?: ResumenEjecutivoVista
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
  const [informePdfLoading, setInformePdfLoading] = useState(false)
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
  const [terminosCheckError, setTerminosCheckError] = useState<string | null>(null)

  const [fuenteTerminos, setFuenteTerminos] = useState<FuenteTerminos>('drive')
  const [terminosTexto, setTerminosTexto] = useState('')
  const [criteriosManual, setCriteriosManual] = useState<CriterioManual[]>([
    { ...CRITERIO_VACIO },
    { ...CRITERIO_VACIO, tipo: 'economico', unidad: 'COP/mes' },
  ])
  const [criteriosExtraidos, setCriteriosExtraidos] = useState<CriterioManual[]>([])
  const [extraerCriteriosLoading, setExtraerCriteriosLoading] = useState(false)
  const [configTrOpen, setConfigTrOpen] = useState(false)
  const [clarificacionOpen, setClarificacionOpen] = useState(false)
  const [clarificacionPreguntas, setClarificacionPreguntas] = useState<
    { id: string; pregunta: string; contexto?: string }[]
  >([])
  const [clarificacionConfianza, setClarificacionConfianza] = useState<number | null>(null)
  const [clarificacionRespuestas, setClarificacionRespuestas] = useState<Record<string, string>>({})

  const [flywheelOpen, setFlywheelOpen] = useState(false)
  const [flywheelRating, setFlywheelRating] = useState<number>(0)
  const [flywheelObs, setFlywheelObs] = useState('')
  const [flywheelSaving, setFlywheelSaving] = useState(false)
  const [flywheelSavedMsg, setFlywheelSavedMsg] = useState<string | null>(null)

  const [analisisRecientes, setAnalisisRecientes] = useState<AnalisisRecienteRow[]>([])
  const [analisisRecientesLoading, setAnalisisRecientesLoading] = useState(false)

  const browseGenRef = useRef(0)

  useEffect(() => {
    setCuadroTab('resumen')
  }, [historialSelectedId])

  useEffect(() => {
    setFlywheelOpen(false)
    setFlywheelRating(0)
    setFlywheelObs('')
    setFlywheelSaving(false)
    setFlywheelSavedMsg(null)
  }, [analisisGuardado, compararResult, historialSelectedId])

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
    setClarificacionOpen(false)
    setClarificacionPreguntas([])
    setClarificacionRespuestas({})
    setClarificacionConfianza(null)
    setCriteriosExtraidos([])
    setTerminosTexto('')
  }, [currentParentId])

  useEffect(() => {
    if (terminosEncontrado?.id) {
      setFuenteTerminos('drive')
    } else if (!terminosCheckLoading && currentParentId) {
      setFuenteTerminos('texto')
      setConfigTrOpen(true)
    }
  }, [terminosEncontrado?.id, terminosCheckLoading, currentParentId])

  useEffect(() => {
    if (!token || !currentParentId || (folders.length === 0 && files.length === 0)) {
      setTerminosEncontrado(null)
      return
    }
    let cancelled = false
    setTerminosCheckLoading(true)
    setTerminosCheckError(null)
    void apiJson<{ data: { id: string; name: string } | null; error: { message?: string; code?: string } | null }>(
      `/api/convocatorias-drive/terminos?folder_id=${encodeURIComponent(currentParentId)}`,
      token,
    )
      .then((res) => {
        if (cancelled) return
        setTerminosEncontrado(res.data ?? null)
        setTerminosCheckError(res.error?.message ?? null)
      })
      .catch((e) => {
        if (!cancelled) {
          setTerminosEncontrado(null)
          setTerminosCheckError(e instanceof Error ? e.message : 'Error comprobando términos')
        }
      })
      .finally(() => {
        if (!cancelled) setTerminosCheckLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, currentParentId, folders.length, files.length])

  const layoutSoloPdfsEnServicio = folders.length === 0 && files.length > 0

  const trConfigurado = useMemo(() => {
    if (fuenteTerminos === 'drive') return Boolean(terminosEncontrado?.id)
    if (fuenteTerminos === 'texto') {
      return criteriosExtraidos.length >= 1 || terminosTexto.trim().length >= 80
    }
    return criteriosManual.filter((c) => c.nombre.trim()).length >= 2
  }, [fuenteTerminos, terminosEncontrado, terminosTexto, criteriosExtraidos, criteriosManual])

  const puedeComparar = useMemo(() => {
    if (!currentParentId) return false
    const hayProveedores = folders.length > 0 || files.length > 0
    return hayProveedores && trConfigurado
  }, [currentParentId, folders.length, files.length, trConfigurado])

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

  const analisisIdParaInforme = useMemo(() => {
    if (analisisGuardado?.id && typeof analisisGuardado.id === 'string') return analisisGuardado.id
    if (compararResult?.analisis_id && typeof compararResult.analisis_id === 'string') {
      return compararResult.analisis_id
    }
    return null
  }, [analisisGuardado, compararResult])

  async function descargarInformePdf() {
    if (!token || !analisisIdParaInforme) return
    setInformePdfLoading(true)
    setCompararError(null)
    try {
      const blob = await apiPdfBlob(
        `/api/convocatorias-drive/analisis/${encodeURIComponent(analisisIdParaInforme)}/informe-pdf`,
        token,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe-comparativo-${analisisIdParaInforme.slice(0, 8)}.pdf`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setCompararError(e instanceof Error ? e.message : 'No se pudo generar el informe PDF')
    } finally {
      setInformePdfLoading(false)
    }
  }

  function buildCompararBody(extraClarificaciones?: { id: string; pregunta?: string; respuesta: string }[]) {
    const clarificaciones =
      extraClarificaciones ??
      clarificacionPreguntas
        .map((p) => ({
          id: p.id,
          pregunta: p.pregunta,
          respuesta: (clarificacionRespuestas[p.id] ?? '').trim(),
        }))
        .filter((c) => c.respuesta.length > 0)

    return {
      folder_id: currentParentId!,
      fuente_terminos: fuenteTerminos,
      terminos_texto: fuenteTerminos === 'texto' ? terminosTexto.trim() : undefined,
      criterios_manual:
        fuenteTerminos === 'manual'
          ? criteriosManual.filter((c) => c.nombre.trim())
          : undefined,
      clarificaciones: clarificaciones.length > 0 ? clarificaciones : undefined,
    }
  }

  async function extraerCriteriosDesdeTexto() {
    if (!token || terminosTexto.trim().length < 80) return
    setExtraerCriteriosLoading(true)
    setCompararError(null)
    try {
      const res = await apiJson<{
        criterios: CriterioManual[] | null
        error: { message?: string } | null
      }>(`/api/convocatorias-drive/extraer-criterios-texto`, token, {
        method: 'POST',
        body: JSON.stringify({ terminos_texto: terminosTexto.trim() }),
      })
      if (res.error?.message) throw new Error(res.error.message)
      setCriteriosExtraidos(res.criterios ?? [])
    } catch (e) {
      setCompararError(e instanceof Error ? e.message : 'No se pudieron extraer criterios')
    } finally {
      setExtraerCriteriosLoading(false)
    }
  }

  async function comparar(clarificacionesExtra?: { id: string; pregunta?: string; respuesta: string }[]) {
    if (!token || !currentParentId) return
    setCompararLoading(true)
    setCompararError(null)
    if (!clarificacionesExtra) setCompararResult(null)
    try {
      const res = await apiJson<Record<string, unknown>>(`/api/convocatorias-drive/comparar`, token, {
        method: 'POST',
        body: JSON.stringify(buildCompararBody(clarificacionesExtra)),
      })
      setClarificacionOpen(false)
      setClarificacionPreguntas([])
      setCompararResult(res)
      setCuadroTab('resumen')
      setAnalisisGuardado(null)
      setHistorialSelectedId(null)
      await loadHistorial()
      await loadAnalisisRecientes()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NEEDS_CLARIFICATION') {
        const payload = e.payload as {
          preguntas?: { id: string; pregunta: string; contexto?: string }[]
          confianza_pct?: number
        }
        setClarificacionPreguntas(payload.preguntas ?? [])
        setClarificacionConfianza(
          typeof payload.confianza_pct === 'number' ? payload.confianza_pct : null,
        )
        setClarificacionOpen(true)
        setCompararError(null)
        return
      }
      setCompararError(e instanceof Error ? e.message : 'Error al comparar')
    } finally {
      setCompararLoading(false)
    }
  }

  function continuarCompararTrasClarificacion() {
    const faltan = clarificacionPreguntas.some((p) => !(clarificacionRespuestas[p.id] ?? '').trim())
    if (faltan) {
      setCompararError('Responde todas las preguntas para continuar.')
      return
    }
    const clar = clarificacionPreguntas.map((p) => ({
      id: p.id,
      pregunta: p.pregunta,
      respuesta: clarificacionRespuestas[p.id]!.trim(),
    }))
    void comparar(clar)
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
    let resumen_ejecutivo: ResumenEjecutivoVista | undefined
    const reRaw = e.resumen_ejecutivo
    if (reRaw && typeof reRaw === 'object') {
      const re = reRaw as Record<string, unknown>
      const provs = Array.isArray(re.proveedores) ? re.proveedores : []
      resumen_ejecutivo = {
        sintesis_global: String(re.sintesis_global ?? ''),
        proveedores: provs.map((p) => {
          const row = p as Record<string, unknown>
          const por = Array.isArray(row.por_criterio) ? row.por_criterio : []
          return {
            proveedor: String(row.proveedor ?? ''),
            puntaje_global:
              typeof row.puntaje_global === 'number' && Number.isFinite(row.puntaje_global)
                ? row.puntaje_global
                : null,
            veredicto: String(row.veredicto ?? ''),
            por_criterio: por.map((c) => {
              const cr = c as Record<string, unknown>
              return {
                criterio: String(cr.criterio ?? ''),
                peso_pct: Number(cr.peso_pct) || 0,
                medicion_tr: String(cr.medicion_tr ?? ''),
                valor_ofertado: String(cr.valor_ofertado ?? '—'),
                confianza_extraccion:
                  typeof cr.confianza_extraccion === 'string' ? cr.confianza_extraccion : null,
                subpuntaje_10: Number(cr.subpuntaje_10) || 0,
                hallazgo: String(cr.hallazgo ?? ''),
              }
            }),
          }
        }),
      }
    }
    if (
      ac.length === 0 &&
      !financiero.resumen &&
      comparativo.length === 0 &&
      !financiero.analisis_propuesta_economica &&
      !resumen_ejecutivo?.sintesis_global
    ) {
      return null
    }
    return { resumen_ejecutivo, analisis_criterios: ac, financiero }
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

  const proveedoresEvalCols = useMemo(() => {
    if (!extendidoVista) return []
    const s = new Set<string>()
    for (const c of extendidoVista.analisis_criterios) {
      for (const pr of c.proveedores ?? []) {
        if (pr?.proveedor) s.add(String(pr.proveedor))
      }
    }
    const base =
      proveedoresDocCols.length > 0
        ? proveedoresDocCols
        : (todasProps.map((p) => p.proveedor).filter((x): x is string => Boolean(x)) as string[])
    const ordered = base.filter((p) => s.has(p))
    const rest = [...s].filter((p) => !ordered.includes(p))
    return [...ordered, ...rest.sort((a, b) => a.localeCompare(b))]
  }, [extendidoVista, proveedoresDocCols, todasProps])

  const evalLookup = useMemo(() => {
    const m = new Map<
      string,
      {
        puntaje_criterio?: number
        valor_ofertado?: string
        confianza_extraccion?: string
        bullets?: string[]
      }
    >()
    for (const c of extendidoVista?.analisis_criterios ?? []) {
      const crit = String(c.criterio ?? '')
      if (!crit) continue
      for (const pr of c.proveedores ?? []) {
        const prov = String((pr as { proveedor?: unknown }).proveedor ?? '')
        if (!prov) continue
        const row = pr as Record<string, unknown>
        m.set(`${crit}\0${prov}`, {
          puntaje_criterio: typeof row.puntaje_criterio === 'number' ? row.puntaje_criterio : undefined,
          valor_ofertado: typeof row.valor_ofertado === 'string' ? row.valor_ofertado : undefined,
          confianza_extraccion:
            typeof row.confianza_extraccion === 'string' ? row.confianza_extraccion : undefined,
          bullets: Array.isArray(row.bullets) ? (row.bullets as string[]) : undefined,
        })
      }
    }
    return m
  }, [extendidoVista])

  const resumenLookup = useMemo(() => {
    const provs = extendidoVista?.resumen_ejecutivo?.proveedores ?? []
    const proveedores = provs.map((p) => p.proveedor).filter((x) => x.trim())
    const criteriosSet = new Set<string>()
    const m = new Map<
      string,
      {
        subpuntaje_10?: number
        valor_ofertado?: string
        confianza_extraccion?: string | null
        hallazgo?: string
        medicion_tr?: string
        peso_pct?: number
      }
    >()
    for (const p of provs) {
      const prov = p.proveedor
      for (const c of p.por_criterio ?? []) {
        const crit = c.criterio
        if (!prov || !crit) continue
        criteriosSet.add(crit)
        m.set(`${crit}\0${prov}`, {
          subpuntaje_10: typeof c.subpuntaje_10 === 'number' ? c.subpuntaje_10 : undefined,
          valor_ofertado: c.valor_ofertado,
          confianza_extraccion: c.confianza_extraccion,
          hallazgo: c.hallazgo,
          medicion_tr: c.medicion_tr,
          peso_pct: c.peso_pct,
        })
      }
    }
    const criteriosRows = criterios
      .map((c) => String((c as { nombre?: unknown }).nombre ?? ''))
      .filter((x) => x && criteriosSet.has(x))
    const rest = [...criteriosSet].filter((x) => !criteriosRows.includes(x))
    return { proveedores, criterios: [...criteriosRows, ...rest.sort((a, b) => a.localeCompare(b))], m }
  }, [extendidoVista, criterios])

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
                  <p className="hidden max-w-48 truncate text-right font-mono text-xs font-medium text-slate-600 sm:block">
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
              <section className="tr-config">
                <button
                  type="button"
                  className="tr-config__toggle"
                  onClick={() => setConfigTrOpen((v) => !v)}
                >
                  {configTrOpen ? '▾' : '▸'} Configurar evaluación (TR / criterios)
                </button>
                {configTrOpen ? (
                  <div className="tr-config__body">
                    <fieldset className="tr-config__fuentes">
                      <legend>Fuente de términos</legend>
                      <label>
                        <input
                          type="radio"
                          name="fuente-tr"
                          checked={fuenteTerminos === 'drive'}
                          disabled={!terminosEncontrado?.id}
                          onChange={() => setFuenteTerminos('drive')}
                        />
                        TR en Drive
                        {terminosEncontrado ? ` (${terminosEncontrado.name})` : ''}
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="fuente-tr"
                          checked={fuenteTerminos === 'texto'}
                          onChange={() => setFuenteTerminos('texto')}
                        />
                        Pegar texto del TR
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="fuente-tr"
                          checked={fuenteTerminos === 'manual'}
                          onChange={() => setFuenteTerminos('manual')}
                        />
                        Criterios manuales
                      </label>
                    </fieldset>

                    {fuenteTerminos === 'texto' ? (
                      <>
                        <label className="tr-config__label" htmlFor="terminos-texto">
                          Texto de términos de referencia
                        </label>
                        <textarea
                          id="terminos-texto"
                          className="tr-config__textarea"
                          rows={6}
                          value={terminosTexto}
                          placeholder="Pega aquí el TR completo o la matriz de evaluación (criterios, pesos, documentos exigidos)…"
                          onChange={(e) => setTerminosTexto(e.target.value)}
                        />
                        <button
                          type="button"
                          className="secondary"
                          disabled={extraerCriteriosLoading || terminosTexto.trim().length < 80}
                          onClick={() => void extraerCriteriosDesdeTexto()}
                        >
                          {extraerCriteriosLoading ? 'Extrayendo criterios…' : 'Extraer criterios con IA'}
                        </button>
                        {criteriosExtraidos.length > 0 ? (
                          <p className="hint muted">
                            {criteriosExtraidos.length} criterio(s) detectados:{' '}
                            {criteriosExtraidos.map((c) => c.nombre).join(', ')}
                          </p>
                        ) : null}
                      </>
                    ) : null}

                    {fuenteTerminos === 'manual' ? (
                      <div className="criterios-manual">
                        <p className="hint muted">
                          Define al menos 2 criterios con nombre, peso % y unidad (ej. COP/mes). Los pesos se
                          normalizan a ~100%.
                        </p>
                        {criteriosManual.map((c, idx) => (
                          <div key={idx} className="criterio-row">
                            <input
                              type="text"
                              placeholder="Nombre del criterio"
                              value={c.nombre}
                              onChange={(e) => {
                                const next = [...criteriosManual]
                                next[idx] = { ...c, nombre: e.target.value }
                                setCriteriosManual(next)
                              }}
                            />
                            <input
                              type="number"
                              min={0}
                              max={100}
                              placeholder="%"
                              value={c.peso || ''}
                              onChange={(e) => {
                                const next = [...criteriosManual]
                                next[idx] = { ...c, peso: Number(e.target.value) || 0 }
                                setCriteriosManual(next)
                              }}
                            />
                            <select
                              value={c.tipo}
                              onChange={(e) => {
                                const next = [...criteriosManual]
                                next[idx] = {
                                  ...c,
                                  tipo: e.target.value as CriterioManual['tipo'],
                                }
                                setCriteriosManual(next)
                              }}
                            >
                              <option value="economico">Económico</option>
                              <option value="tecnico">Técnico</option>
                              <option value="experiencia">Experiencia</option>
                              <option value="juridico">Jurídico</option>
                            </select>
                            <input
                              type="text"
                              placeholder="Unidad"
                              value={c.unidad}
                              onChange={(e) => {
                                const next = [...criteriosManual]
                                next[idx] = { ...c, unidad: e.target.value }
                                setCriteriosManual(next)
                              }}
                            />
                            <input
                              type="text"
                              className="criterio-row__desc"
                              placeholder="Qué se evalúa"
                              value={c.descripcion}
                              onChange={(e) => {
                                const next = [...criteriosManual]
                                next[idx] = { ...c, descripcion: e.target.value }
                                setCriteriosManual(next)
                              }}
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setCriteriosManual([...criteriosManual, { ...CRITERIO_VACIO }])
                          }
                        >
                          + Criterio
                        </button>
                      </div>
                    ) : null}

                    <p className="hint muted tr-config__flywheel">
                      Flywheel Endir: las aclaraciones y correcciones que confirmes se guardan y mejoran
                      comparaciones futuras del mismo servicio.
                    </p>
                  </div>
                ) : null}
              </section>
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
                  <p className={`hint${terminosCheckError ? ' error' : ''}`}>
                    {terminosCheckLoading
                      ? 'Comprobando TR…'
                      : folders.length === 0 && files.length === 0
                        ? 'Entra a la carpeta del servicio (subcarpetas de proveedores o PDFs sueltos).'
                        : !trConfigurado
                          ? 'Configura el TR: Drive, pega el texto o define criterios manuales (mín. 2).'
                          : terminosCheckError
                            ? terminosCheckError
                            : 'Sin TR en carpeta central (PDF/Word: TR HSG + nombre del servicio).'}
                  </p>
                ) : fuenteTerminos === 'drive' && terminosEncontrado ? (
                  <>
                    <p className="hint muted" title={terminosEncontrado.name}>
                      TR vinculado
                    </p>
                    {layoutSoloPdfsEnServicio ? (
                      <p className="hint muted">
                        {files.length} PDF en carpeta: cada archivo = un proveedor.
                      </p>
                    ) : null}
                  </>
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

            {vista && analisisIdParaInforme ? (
              <div className="informe-pdf-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={informePdfLoading || compararLoading}
                  onClick={() => void descargarInformePdf()}
                >
                  {informePdfLoading ? 'Generando informe PDF…' : 'Descargar informe PDF (Top 3)'}
                </button>
                <p className="muted informe-pdf-actions__hint">
                  Incluye resumen comparativo por criterios del TR y enlaces a las propuestas en Google Drive.
                </p>
              </div>
            ) : null}

            {vista ? (
              <section className="flywheel-card">
                <button
                  type="button"
                  className="flywheel-card__toggle"
                  onClick={() => setFlywheelOpen((v) => !v)}
                >
                  {flywheelOpen ? '▾' : '▸'} Calificar análisis / dejar observación (mejora continua)
                </button>
                {flywheelOpen ? (
                  <div className="flywheel-card__body">
                    <div className="flywheel-rating">
                      <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        Calificación (1–5)
                      </span>
                      <div className="flywheel-rating__buttons" role="radiogroup" aria-label="Calificación Endir">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="flywheel-rating__btn"
                            data-active={flywheelRating === n}
                            onClick={() => setFlywheelRating(n)}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="flywheel-label" htmlFor="flywheel-obs">
                      Observación (qué estuvo bien / qué corregir)
                    </label>
                    <textarea
                      id="flywheel-obs"
                      className="flywheel-textarea"
                      rows={3}
                      value={flywheelObs}
                      placeholder="Ej: El precio de Proveedor A es mensual y el de Proveedor B es total contrato; separar. O: En el criterio Experiencia faltó citar el valor ofertado."
                      onChange={(e) => setFlywheelObs(e.target.value)}
                    />

                    <div className="flywheel-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={flywheelSaving}
                        onClick={() => {
                          setFlywheelRating(0)
                          setFlywheelObs('')
                          setFlywheelSavedMsg(null)
                        }}
                      >
                        Limpiar
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={flywheelSaving || (flywheelRating < 1 && flywheelObs.trim().length < 6)}
                        onClick={async () => {
                          if (!token) return
                          setFlywheelSaving(true)
                          setFlywheelSavedMsg(null)
                          try {
                            const payload = {
                              folder_id: String((vista as { folder_id?: unknown }).folder_id ?? currentParentId ?? ''),
                              servicio: String((vista as { servicio?: unknown }).servicio ?? ''),
                              conjunto: String((vista as { conjunto?: unknown }).conjunto ?? ''),
                              tipo: 'calificacion_analisis',
                              calificacion_endir: flywheelRating >= 1 ? flywheelRating : undefined,
                              payload: {
                                analisis_id: String((vista as { id?: unknown }).id ?? ''),
                                observacion: flywheelObs.trim(),
                                fuente: 'ui',
                              },
                            }
                            await apiJson<{ ok: boolean }>(`/api/convocatorias-drive/flywheel`, token, {
                              method: 'POST',
                              body: JSON.stringify(payload),
                            })
                            setFlywheelSavedMsg('Guardado. Se usará como aprendizaje en próximas comparaciones.')
                          } catch (e) {
                            setFlywheelSavedMsg(e instanceof Error ? e.message : 'No se pudo guardar el feedback.')
                          } finally {
                            setFlywheelSaving(false)
                          }
                        }}
                      >
                        {flywheelSaving ? 'Guardando…' : 'Guardar feedback'}
                      </button>
                    </div>

                    {flywheelSavedMsg ? <p className="hint muted">{flywheelSavedMsg}</p> : null}
                  </div>
                ) : null}
              </section>
            ) : null}

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
                    {extendidoVista?.resumen_ejecutivo?.sintesis_global ? (
                      <>
                        <h3>Síntesis</h3>
                        <p className="analisis-fin-resumen">{extendidoVista.resumen_ejecutivo.sintesis_global}</p>
                      </>
                    ) : null}

                    {top3.length > 0 ? (
                      <>
                        <h3 style={{ marginTop: '1rem' }}>Ranking</h3>
                        <table className="table table-compact">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Proveedor</th>
                              <th>Puntaje</th>
                            </tr>
                          </thead>
                          <tbody>
                            {top3.map((t, i) => (
                              <tr key={i}>
                                <td>{i + 1}</td>
                                <td>{t.proveedor}</td>
                                <td>{t.puntaje}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    ) : null}

                    {extendidoVista?.resumen_ejecutivo?.proveedores?.length ? (
                      <>
                        <h3 style={{ marginTop: '1.25rem' }}>Por proveedor (criterios del TR)</h3>
                        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.75rem' }}>
                          Misma base que «Análisis general»: medición según TR, valor extraído, confianza y hallazgo por
                          criterio.
                        </p>
                        <div className="resumen-proveedores-stack">
                          {extendidoVista.resumen_ejecutivo.proveedores.map((pr) => {
                            const puntajeTabla = todasProps.find(
                              (p) =>
                                p.proveedor === pr.proveedor ||
                                (p.proveedor &&
                                  pr.proveedor &&
                                  p.proveedor.toLowerCase() === pr.proveedor.toLowerCase()),
                            )?.puntaje
                            const puntaje =
                              pr.puntaje_global ?? (typeof puntajeTabla === 'number' ? puntajeTabla : null)
                            return (
                              <article key={pr.proveedor} className="resumen-proveedor-card">
                                <header className="resumen-proveedor-card__head">
                                  <h4>{pr.proveedor}</h4>
                                  {puntaje != null ? (
                                    <span className="resumen-proveedor-card__score">Puntaje global: {puntaje}</span>
                                  ) : null}
                                </header>
                                {pr.veredicto ? <p className="resumen-proveedor-card__veredicto">{pr.veredicto}</p> : null}
                                {pr.por_criterio.length > 0 ? (
                                  <div className="cuadro-table-scroll">
                                    <table className="table table-compact resumen-criterios-table">
                                      <thead>
                                        <tr>
                                          <th>Criterio</th>
                                          <th>Peso</th>
                                          <th>Medición (TR)</th>
                                          <th>Ofertado</th>
                                          <th>Conf.</th>
                                          <th>/10</th>
                                          <th>Hallazgo</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {pr.por_criterio.map((c, ci) => (
                                          <tr key={ci}>
                                            <td>{c.criterio}</td>
                                            <td>{c.peso_pct}%</td>
                                            <td className="wrap muted">{c.medicion_tr}</td>
                                            <td className="wrap">{c.valor_ofertado}</td>
                                            <td>
                                              {c.confianza_extraccion && isConfianza(c.confianza_extraccion) ? (
                                                <span className={`badge-conf ${c.confianza_extraccion}`}>
                                                  {c.confianza_extraccion}
                                                </span>
                                              ) : (
                                                '—'
                                              )}
                                            </td>
                                            <td>{c.subpuntaje_10}</td>
                                            <td className="wrap">{c.hallazgo}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null}
                              </article>
                            )
                          })}
                        </div>
                      </>
                    ) : todasProps.length > 0 ? (
                      <>
                        <h3 style={{ marginTop: '1rem' }}>Justificación por proveedor</h3>
                        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.65rem' }}>
                          Análisis anterior sin resumen ejecutivo unificado. Ejecuta «Comparar» de nuevo para el detalle por
                          criterio del TR.
                        </p>
                        {todasProps.map((p, i) => (
                          <div key={i} className="extraccion-block">
                            <h4>
                              {p.proveedor}
                              {typeof p.puntaje === 'number' ? ` — ${p.puntaje}` : ''}
                            </h4>
                            <p className="wrap muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                              {p.justificacion || 'Sin justificación.'}
                            </p>
                          </div>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}

                {cuadroTab === 'general' ? (
                  extendidoVista ? (
                    <>
                      <h3>Evaluación por criterio del TR</h3>
                      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.85rem' }}>
                        Solo los criterios definidos en los Términos de Referencia. Cada proveedor se evalúa con la
                        medición del TR, el valor extraído de su propuesta y la confianza de lectura.
                      </p>

                      {extendidoVista.analisis_criterios.length > 0 && proveedoresEvalCols.length > 0 ? (
                        <div className="cuadro-table-scroll">
                          <table className="table table-doc-matrix table-eval-matrix">
                            <thead>
                              <tr>
                                <th className="table-doc-matrix__req">Criterio (TR)</th>
                                {proveedoresEvalCols.map((prov) => (
                                  <th key={prov} className="table-doc-matrix__prov">
                                    {prov}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {extendidoVista.analisis_criterios.map((bl, idx) => (
                                <tr key={`${bl.criterio}-${idx}`}>
                                  <td className="table-doc-matrix__req">
                                    <strong>{bl.criterio}</strong>
                                    <div className="table-eval-crit-meta">
                                      {bl.peso_pct != null ? <span className="badge">Peso {bl.peso_pct}%</span> : null}
                                      {bl.tipo_criterio ? <span className="badge">{bl.tipo_criterio}</span> : null}
                                    </div>
                                    {bl.medicion_tr ? (
                                      <p className="muted table-doc-matrix__desc">{bl.medicion_tr}</p>
                                    ) : null}
                                  </td>
                                  {proveedoresEvalCols.map((prov) => {
                                    const c = evalLookup.get(`${bl.criterio}\0${prov}`)
                                    const conf = c?.confianza_extraccion
                                    const bullets = (c?.bullets ?? []).slice(0, 4)
                                    return (
                                      <td key={prov} className="wrap table-doc-matrix__cell table-eval-cell">
                                        {typeof c?.puntaje_criterio === 'number' ? (
                                          <div className="table-eval-score">
                                            <strong>{c.puntaje_criterio}</strong> / 10
                                          </div>
                                        ) : (
                                          <div className="table-eval-score muted">—</div>
                                        )}
                                        {c?.valor_ofertado ? (
                                          <div className="table-eval-oferta">
                                            <span className="muted">Ofertado:</span> {c.valor_ofertado}
                                          </div>
                                        ) : null}
                                        {conf && isConfianza(conf) ? (
                                          <span className={`badge-conf ${conf}`}>conf. {conf}</span>
                                        ) : null}
                                        {bullets.length > 0 ? (
                                          <ul className="table-eval-bullets">
                                            {bullets.map((b, bi) => (
                                              <li key={bi}>{b}</li>
                                            ))}
                                          </ul>
                                        ) : null}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      <details className="docs-collapsible" style={{ marginTop: '1rem' }}>
                        <summary>Ver detalle completo por criterio</summary>
                        <div className="analisis-criterios-stack">
                          {extendidoVista.analisis_criterios.map((bl, idx) => (
                            <article key={`${bl.criterio}-${idx}`} className="analisis-criterio-card">
                              <header className="analisis-criterio-card__head">
                                <h4 className="analisis-criterio-card__title">{bl.criterio}</h4>
                                <div className="analisis-criterio-card__meta">
                                  {bl.peso_pct != null ? <span className="badge">Peso {bl.peso_pct}%</span> : null}
                                  {bl.tipo_criterio ? <span className="badge">{bl.tipo_criterio}</span> : null}
                                </div>
                              </header>
                              {bl.medicion_tr ? (
                                <p className="analisis-criterio-card__medicion">
                                  <strong>Criterio de medición (TR):</strong> {bl.medicion_tr}
                                </p>
                              ) : null}
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
                                        Subpuntaje: <strong>{pr.puntaje_criterio}</strong> / 10
                                      </span>
                                    </div>
                                    <p
                                      className="analisis-criterio-proveedor__oferta muted"
                                      style={{ fontSize: 'var(--text-xs)' }}
                                    >
                                      <strong>Ofertado:</strong> {pr.valor_ofertado ?? '—'}
                                      {pr.confianza_extraccion && isConfianza(pr.confianza_extraccion) ? (
                                        <>
                                          {' '}
                                          <span className={`badge-conf ${pr.confianza_extraccion}`}>
                                            conf. extracción {pr.confianza_extraccion}
                                          </span>
                                        </>
                                      ) : null}
                                    </p>
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
                      </details>
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

                    {extendidoVista?.resumen_ejecutivo?.proveedores?.length && resumenLookup.proveedores.length > 0 ? (
                      <>
                        <h3>Cuadro comparable (puntaje + detalle)</h3>
                        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: '0.75rem' }}>
                          Filas = criterio del TR. Columnas = proveedor. Cada celda muestra subpuntaje (0–10), ofertado y
                          hallazgo del análisis.
                        </p>
                        <div className="cuadro-table-scroll">
                          <table className="table table-doc-matrix table-eval-matrix">
                            <thead>
                              <tr>
                                <th className="table-doc-matrix__req">Criterio (TR)</th>
                                {resumenLookup.proveedores.map((prov) => (
                                  <th key={prov} className="table-doc-matrix__prov">
                                    {prov}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {resumenLookup.criterios.map((crit) => (
                                <tr key={crit}>
                                  <td className="table-doc-matrix__req">
                                    <strong>{crit}</strong>
                                    {(() => {
                                      const any = resumenLookup.proveedores
                                        .map((p) => resumenLookup.m.get(`${crit}\0${p}`))
                                        .find(Boolean)
                                      return any?.medicion_tr ? (
                                        <p className="muted table-doc-matrix__desc">{any.medicion_tr}</p>
                                      ) : null
                                    })()}
                                  </td>
                                  {resumenLookup.proveedores.map((prov) => {
                                    const c = resumenLookup.m.get(`${crit}\0${prov}`)
                                    const conf = c?.confianza_extraccion ?? null
                                    return (
                                      <td key={prov} className="wrap table-doc-matrix__cell table-eval-cell">
                                        {typeof c?.subpuntaje_10 === 'number' ? (
                                          <div className="table-eval-score">
                                            <strong>{c.subpuntaje_10}</strong> / 10
                                          </div>
                                        ) : (
                                          <div className="table-eval-score muted">—</div>
                                        )}
                                        {c?.valor_ofertado ? (
                                          <div className="table-eval-oferta">
                                            <span className="muted">Ofertado:</span> {c.valor_ofertado}
                                          </div>
                                        ) : null}
                                        {conf && typeof conf === 'string' && isConfianza(conf) ? (
                                          <span className={`badge-conf ${conf}`}>conf. {conf}</span>
                                        ) : null}
                                        {c?.hallazgo ? <div className="table-eval-hallazgo">{c.hallazgo}</div> : null}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
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
                                      {c?.nota ? (
                                        <p className="muted table-doc-matrix__nota" style={{ margin: '0.25rem 0 0', fontSize: 'var(--text-xs)' }}>
                                          {c.nota}
                                        </p>
                                      ) : null}
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

      {clarificacionOpen ? (
        <div className="clarificacion-overlay" role="dialog" aria-modal="true" aria-labelledby="clarif-title">
          <div className="clarificacion-panel">
            <h2 id="clarif-title">Aclaraciones antes de comparar</h2>
            <p className="hint muted">
              Confianza actual:{' '}
              {clarificacionConfianza != null ? `${clarificacionConfianza}%` : '—'} (necesitamos ≥ 90%)
            </p>
            <p>
              No asumimos datos ambiguos. Responde con precisión; si hace falta, volveremos a preguntar hasta
              alcanzar confianza suficiente.
            </p>
            <ul className="clarificacion-list">
              {clarificacionPreguntas.map((p) => (
                <li key={p.id}>
                  <label htmlFor={`clar-${p.id}`}>{p.pregunta}</label>
                  {p.contexto ? <p className="hint muted">{p.contexto}</p> : null}
                  <textarea
                    id={`clar-${p.id}`}
                    rows={2}
                    value={clarificacionRespuestas[p.id] ?? ''}
                    onChange={(e) =>
                      setClarificacionRespuestas((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                  />
                </li>
              ))}
            </ul>
            <div className="clarificacion-actions">
              <button type="button" className="secondary" onClick={() => setClarificacionOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                disabled={compararLoading}
                onClick={() => continuarCompararTrasClarificacion()}
              >
                {compararLoading ? 'Comparando…' : 'Continuar comparación'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageChrome>
  )
}
