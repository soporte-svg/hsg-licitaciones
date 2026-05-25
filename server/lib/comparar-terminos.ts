import { z } from 'zod'
import type { CriterioRow, RequisitoDocumentoTr } from './convocatorias-drive-ia.js'
import {
  evaluarConfianzaYClarificacion,
  extractCriteriosFromTerminosText,
  extractDocumentosFromTerminosText,
  normalizeCriteriosManual,
} from './convocatorias-drive-ia.js'
import { formatFlywheelPromptAppendix, loadFlywheelContext, saveFlywheelEntry } from './flywheel-aprendizaje.js'

export const CONFIANZA_UMBRAL = 90

export const criterioInputSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().default(''),
  peso: z.number().min(0).max(100),
  tipo: z.enum(['economico', 'tecnico', 'experiencia', 'juridico']),
  unidad: z.string().default(''),
})

export const clarificacionSchema = z.object({
  id: z.string().min(1),
  pregunta: z.string().optional(),
  respuesta: z.string().min(1),
})

export const compararTerminosInputSchema = z.object({
  folder_id: z.string().min(3),
  fuente_terminos: z.enum(['drive', 'texto', 'manual']).default('drive'),
  terminos_texto: z.string().optional(),
  criterios_manual: z.array(criterioInputSchema).optional(),
  clarificaciones: z.array(clarificacionSchema).optional(),
})

export type CompararTerminosInput = z.infer<typeof compararTerminosInputSchema>

export type ClarificacionPregunta = {
  id: string
  pregunta: string
  contexto?: string
}

export type PreparacionCompararResult = {
  confianza_pct: number
  necesita_clarificacion: boolean
  preguntas: ClarificacionPregunta[]
  criterios: CriterioRow[]
  documentos_count: number
  fuente_terminos: 'drive' | 'texto' | 'manual'
  advertencias: string[]
}

type DriveLike = {
  findTerminosFileForServiceFolder: (folderId: string) => Promise<{ id: string; name: string; mimeType?: string } | null>
  downloadTerminosFile: (id: string, mimeType?: string) => Promise<{ buffer: Buffer; name: string; mimeType: string }>
  walkAncestorsFromFolder: (folderId: string) => Promise<string[]>
  inferConvocatoriaMeta: (names: string[]) => { conjunto: string; servicio: string; anio: number }
}

type IaLike = {
  extractCriteriosFromTerminosDocument: (
    buffer: Buffer,
    title: string,
    mimeType: string,
  ) => Promise<CriterioRow[]>
  extractDocumentosRequeridosFromTerminos: (
    buffer: Buffer,
    title: string,
    mimeType: string,
  ) => Promise<RequisitoDocumentoTr[]>
}

export async function resolveCriteriosYDocumentos(args: {
  input: CompararTerminosInput
  drive: DriveLike
  ia: IaLike
  iaCache?: {
    terminos_file_id: string | null
    criterios: CriterioRow[]
    documentos_requeridos: RequisitoDocumentoTr[]
  } | null
}): Promise<{
  criterios: CriterioRow[]
  documentosRequeridosTr: RequisitoDocumentoTr[]
  terminos_file_id: string | null
  trCacheHit: boolean
  meta: { conjunto: string; servicio: string; anio: number }
  advertencias: string[]
}> {
  const { input, drive, ia, iaCache } = args
  const advertencias: string[] = []
  const names = await drive.walkAncestorsFromFolder(input.folder_id)
  const meta = drive.inferConvocatoriaMeta(names)

  if (input.fuente_terminos === 'manual') {
    const criterios = normalizeCriteriosManual(input.criterios_manual ?? [])
    if (criterios.length < 2) {
      throw new Error('Define al menos 2 criterios de evaluación (nombre, peso y tipo).')
    }
    const sum = criterios.reduce((s, c) => s + c.peso, 0)
    if (Math.abs(sum - 100) > 2) {
      advertencias.push(`Los pesos suman ${sum.toFixed(1)}% (se espera ~100%).`)
    }
    return {
      criterios,
      documentosRequeridosTr: [],
      terminos_file_id: null,
      trCacheHit: false,
      meta,
      advertencias,
    }
  }

  if (input.fuente_terminos === 'texto') {
    const texto = input.terminos_texto?.trim() ?? ''
    if (texto.length < 80) {
      throw new Error('Pega el texto de los términos de referencia (mínimo ~80 caracteres) o usa criterios manuales.')
    }
    const [criterios, documentosRequeridosTr] = await Promise.all([
      extractCriteriosFromTerminosText(texto),
      extractDocumentosFromTerminosText(texto),
    ])
    if (criterios.length < 1) {
      throw new Error('No se pudieron extraer criterios del texto. Revisa el contenido o define criterios manualmente.')
    }
    return {
      criterios,
      documentosRequeridosTr,
      terminos_file_id: null,
      trCacheHit: false,
      meta,
      advertencias,
    }
  }

  const terminos = await drive.findTerminosFileForServiceFolder(input.folder_id)
  if (!terminos?.id) {
    throw new Error(
      'No hay TR en Drive para esta carpeta. Pega el texto del TR o define los criterios manualmente en «Configurar evaluación».',
    )
  }

  const trCacheHit = Boolean(
    iaCache &&
      iaCache.terminos_file_id === terminos.id &&
      Array.isArray(iaCache.criterios) &&
      iaCache.criterios.length > 0,
  )

  if (trCacheHit && iaCache) {
    return {
      criterios: iaCache.criterios,
      documentosRequeridosTr: iaCache.documentos_requeridos ?? [],
      terminos_file_id: terminos.id,
      trCacheHit: true,
      meta,
      advertencias,
    }
  }

  const { buffer: terminosBuf, name: terminosName, mimeType: terminosMime } =
    await drive.downloadTerminosFile(terminos.id, terminos.mimeType)
  const esPdfTr = terminosMime === 'application/pdf'
  let criterios: CriterioRow[]
  let documentosRequeridosTr: RequisitoDocumentoTr[]
  if (esPdfTr) {
    criterios = await ia.extractCriteriosFromTerminosDocument(terminosBuf, terminosName, terminosMime)
    documentosRequeridosTr = await ia.extractDocumentosRequeridosFromTerminos(
      terminosBuf,
      terminosName,
      terminosMime,
    )
  } else {
    ;[criterios, documentosRequeridosTr] = await Promise.all([
      ia.extractCriteriosFromTerminosDocument(terminosBuf, terminosName, terminosMime),
      ia.extractDocumentosRequeridosFromTerminos(terminosBuf, terminosName, terminosMime),
    ])
  }

  return {
    criterios,
    documentosRequeridosTr,
    terminos_file_id: terminos.id,
    trCacheHit: false,
    meta,
    advertencias,
  }
}

export async function runPreparacionComparar(args: {
  input: CompararTerminosInput
  drive: DriveLike
  ia: IaLike
  iaCache?: Parameters<typeof resolveCriteriosYDocumentos>[0]['iaCache']
  userEmail: string
}): Promise<PreparacionCompararResult> {
  const resolved = await resolveCriteriosYDocumentos({
    input: args.input,
    drive: args.drive,
    ia: args.ia,
    iaCache: args.iaCache,
  })

  const flywheel = await loadFlywheelContext({
    servicio: resolved.meta.servicio,
    folder_id: args.input.folder_id,
  })
  const flywheelAppendix = formatFlywheelPromptAppendix(flywheel)

  const clar = await evaluarConfianzaYClarificacion({
    servicio: resolved.meta.servicio,
    fuente_terminos: args.input.fuente_terminos,
    criterios: resolved.criterios,
    terminos_texto: args.input.terminos_texto,
    clarificaciones: args.input.clarificaciones,
    flywheelAppendix,
  })

  const confianza_pct = clar.confianza_pct
  const necesita_clarificacion = confianza_pct < CONFIANZA_UMBRAL && clar.preguntas.length > 0

  if (args.input.clarificaciones?.length) {
    void saveFlywheelEntry({
      folder_id: args.input.folder_id,
      servicio: resolved.meta.servicio,
      conjunto: resolved.meta.conjunto,
      tipo: 'clarificacion',
      payload: {
        resumen: args.input.clarificaciones
          .map((c) => `${c.pregunta ?? c.id}: ${c.respuesta}`)
          .join(' | '),
        items: args.input.clarificaciones,
        confianza_pct,
      },
      created_by: args.userEmail,
    })
  }

  return {
    confianza_pct,
    necesita_clarificacion,
    preguntas: clar.preguntas,
    criterios: resolved.criterios,
    documentos_count: resolved.documentosRequeridosTr.length,
    fuente_terminos: args.input.fuente_terminos,
    advertencias: [...resolved.advertencias, ...clar.advertencias],
  }
}
