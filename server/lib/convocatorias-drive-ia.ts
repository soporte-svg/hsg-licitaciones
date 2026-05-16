import mammoth from 'mammoth'
import { z } from 'zod'
import { extractJsonObject } from './json.js'
import { completeLlmText } from './llm-provider.js'
import type { LlmUserBlock, LlmUserContent } from './llm-provider.js'

export { formatLlmError as formatAnthropicError } from './llm-provider.js'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const criterioSchema = z.object({
  nombre: z.string(),
  descripcion: z.string(),
  peso: z.number(),
  tipo: z.enum(['economico', 'tecnico', 'experiencia', 'juridico']),
  unidad: z.string(),
})

const terminosResponseSchema = z.object({
  criterios: z.array(criterioSchema),
  puntaje_total: z.number(),
})

const terminosDocListSchema = z.object({
  documentos: z.array(
    z.object({
      id: z.string(),
      nombre: z.string(),
      descripcion: z.string().optional().default(''),
      obligatorio: z.boolean().catch(true),
    }),
  ),
})

const documentacionAsignacionesSchema = z.object({
  asignaciones: z.array(
    z.object({
      requisito_id: z.string(),
      proveedor: z.string(),
      archivo: z.string().nullable(),
      file_id: z.string().nullable().optional(),
      confianza: z.enum(['alta', 'media', 'baja']).optional(),
      nota: z.string().optional(),
    }),
  ),
})

export type ArchivoEnCarpetaProveedor = { id: string; name: string }

export type RequisitoDocumentoTr = z.infer<typeof terminosDocListSchema>['documentos'][number]
export type DocumentacionAsignacion = z.infer<typeof documentacionAsignacionesSchema>['asignaciones'][number]
export type DocumentacionPayload = {
  requisitos: RequisitoDocumentoTr[]
  archivos_por_proveedor: { proveedor: string; archivos: ArchivoEnCarpetaProveedor[] }[]
  asignaciones: DocumentacionAsignacion[]
}


const propuestaValorSchema = z.object({
  criterio: z.string(),
  valor_ofertado: z.string(),
  valor_numerico: z.number().nullable(),
  confianza: z.enum(['alta', 'media', 'baja']),
})

const propuestaExtractSchema = z.object({
  proveedor: z.string(),
  nit: z.string().nullable(),
  valores: z.array(propuestaValorSchema),
})

const scoringResponseSchema = z.object({
  todas_las_propuestas: z.array(
    z.object({
      proveedor: z.string(),
      puntaje: z.number(),
      valores: z.record(z.unknown()).optional(),
      justificacion: z.string().optional(),
    }),
  ),
  top_3: z.array(
    z.object({
      proveedor: z.string(),
      puntaje: z.number(),
      valores: z.record(z.unknown()).optional(),
      justificacion: z.string().optional(),
    }),
  ),
})

export type CriterioRow = z.infer<typeof criterioSchema>
export type PropuestaExtract = z.infer<typeof propuestaExtractSchema>

const MAX_DOCX_CHARS = 120_000

function pdfAttachmentName(title: string): string {
  const t = title.trim() || 'documento.pdf'
  return /\.pdf$/i.test(t) ? t : `${t}.pdf`
}

const CRITERIOS_PROMPT = `Lee este documento Términos de Referencia y extrae los criterios de evaluación. Retorna exactamente este formato JSON:
{
  "criterios": [
    {
      "nombre": "string — nombre exacto del criterio",
      "descripcion": "string — qué mide este criterio",
      "peso": number — porcentaje de 0 a 100,
      "tipo": "economico" | "tecnico" | "experiencia" | "juridico",
      "unidad": "string — ej: pesos/mes, años, número de empleados"
    }
  ],
  "puntaje_total": number — debe ser 100
}
Si no encuentras el peso de algún criterio, distribúyelo proporcionalmente entre los que sí tienen peso definido.
Responde solo JSON válido, sin markdown ni texto adicional.`

const DOCUMENTOS_TR_PROMPT = `Identifica los DOCUMENTOS que deben allegar los proponentes según estos Términos de Referencia (anexos, formatos únicos (FUE), ítems de propuesta económica o jurada, experiencia, garantías, RUT/certificaciones tributarias y similares). No incluyas aquí los "criterios de evaluación" numéricos: solo ítems documentales allegables por el oferente.

Si el TR lista documentos agrupados, desglósalos en entradas separadas cuando representen obligaciones diferenciadas.

Retorna solo este JSON válido:
{
  "documentos": [
    {
      "id": "string — identificador corto estable en MAYUS_SNAKE (ej DOCUMENTO_LEGAL_REPRESENTANTE)",
      "nombre": "string — denominación según el TR",
      "descripcion": "string — breve, puede estar vacío",
      "obligatorio": boolean — si el TR no especifica opcionalidad, usa true
    }
  ]
}
Responde solo JSON, sin markdown ni texto adicional. Si no encuentras ninguna lista clarificada, usa "documentos": [].`

async function docxToPlainText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer })
  const text = value.trim()
  if (!text) throw new Error('El archivo Word no tiene texto legible.')
  return text
}

function isDocxMime(mimeType: string): boolean {
  return (
    mimeType === DOCX_MIME ||
    mimeType === 'application/msword' ||
    /\.docx?$/i.test(mimeType)
  )
}

export async function extractCriteriosFromTerminosDocument(
  buffer: Buffer,
  title: string,
  mimeType: string,
): Promise<CriterioRow[]> {
  let user: LlmUserContent

  if (mimeType === 'application/pdf') {
    user = [
      {
        type: 'pdf',
        filename: pdfAttachmentName(title),
        base64: buffer.toString('base64'),
      },
      { type: 'text', text: CRITERIOS_PROMPT },
    ]
  } else if (isDocxMime(mimeType) || title.toLowerCase().endsWith('.docx') || title.toLowerCase().endsWith('.doc')) {
    let plain = await docxToPlainText(buffer)
    if (plain.length > MAX_DOCX_CHARS) {
      console.warn(`[ia] términos truncados ${plain.length} → ${MAX_DOCX_CHARS} caracteres`)
      plain = `${plain.slice(0, MAX_DOCX_CHARS)}\n\n[… documento truncado por tamaño …]`
    }
    user = [
      {
        type: 'text',
        text: `Documento: ${title}\n\n---\n${plain}\n---\n\n${CRITERIOS_PROMPT}`,
      },
    ]
  } else {
    throw new Error(`Formato de términos no soportado: ${mimeType}. Usa .docx o .pdf.`)
  }

  const { text } = await completeLlmText({
    user,
    system: 'Eres un experto en análisis de licitaciones en Colombia. Siempre responde con JSON válido, sin texto adicional.',
    label: `criterios ← ${title}`,
  })
  const json = extractJsonObject(text)
  const parsed = terminosResponseSchema.parse(json)
  if (Math.abs(parsed.puntaje_total - 100) > 0.01) {
    console.warn('[convocatorias-drive] puntaje_total != 100:', parsed.puntaje_total)
  }
  return parsed.criterios
}

export async function extractDocumentosRequeridosFromTerminos(
  buffer: Buffer,
  title: string,
  mimeType: string,
): Promise<RequisitoDocumentoTr[]> {
  let user: LlmUserContent

  if (mimeType === 'application/pdf') {
    user = [
      {
        type: 'pdf',
        filename: pdfAttachmentName(title),
        base64: buffer.toString('base64'),
      },
      { type: 'text', text: DOCUMENTOS_TR_PROMPT },
    ]
  } else if (isDocxMime(mimeType) || title.toLowerCase().endsWith('.docx') || title.toLowerCase().endsWith('.doc')) {
    let plain = await docxToPlainText(buffer)
    if (plain.length > MAX_DOCX_CHARS) {
      console.warn(`[ia] términos (documentos TR) truncados ${plain.length} → ${MAX_DOCX_CHARS}`)
      plain = `${plain.slice(0, MAX_DOCX_CHARS)}\n\n[… documento truncado por tamaño …]`
    }
    user = [
      {
        type: 'text',
        text: `Documento: ${title}\n\n---\n${plain}\n---\n\n${DOCUMENTOS_TR_PROMPT}`,
      },
    ]
  } else {
    throw new Error(`Formato de términos no soportado: ${mimeType}. Usa .docx o .pdf.`)
  }

  const { text } = await completeLlmText({
    user,
    system: 'Eres un experto en licitaciones públicas en Colombia. Siempre responde con JSON válido, sin texto adicional.',
    label: `documentos TR ← ${title}`,
  })
  const json = extractJsonObject(text)
  const parsed = terminosDocListSchema.parse(json)
  return parsed.documentos
}

/** Une asignaciones del modelo al grid completo requisitos × proveedores. */
function ensureMatrizDocumentacion(
  requisitos: RequisitoDocumentoTr[],
  porProveedor: { proveedor: string; archivos: ArchivoEnCarpetaProveedor[] }[],
  raw: DocumentacionAsignacion[],
): DocumentacionAsignacion[] {
  const ids = new Set(requisitos.map((r) => r.id))
  const provs = new Set(porProveedor.map((p) => p.proveedor))
  const seen = new Map<string, DocumentacionAsignacion>()
  for (const a of raw) {
    if (!ids.has(a.requisito_id) || !provs.has(a.proveedor)) continue
    const k = `${a.requisito_id}\0${a.proveedor}`
    seen.set(k, a)
  }
  const out: DocumentacionAsignacion[] = []
  for (const r of requisitos) {
    for (const p of porProveedor) {
      const k = `${r.id}\0${p.proveedor}`
      out.push(
        seen.get(k) ?? {
          requisito_id: r.id,
          proveedor: p.proveedor,
          archivo: null,
          confianza: 'baja',
        },
      )
    }
  }
  return out
}

import { enrichAsignacionesWithFileIds } from './documentacion-enrich.js'

export { enrichAsignacionesWithFileIds }

/** Cruza lista de archivos por carpeta (nombres) con los requisitos documentales del TR. */
export async function clasificarDocumentacionProveedores(args: {
  requisitos: RequisitoDocumentoTr[]
  porProveedor: { proveedor: string; archivos: ArchivoEnCarpetaProveedor[] }[]
}): Promise<DocumentacionAsignacion[]> {
  if (args.requisitos.length === 0 || args.porProveedor.length === 0) return []
  if (!args.porProveedor.some((x) => x.archivos.length > 0)) {
    return ensureMatrizDocumentacion(args.requisitos, args.porProveedor, [])
  }

  const rej = JSON.stringify(
    args.requisitos.map((r) => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion })),
    null,
    2,
  )
  const ar = JSON.stringify(
    args.porProveedor.map((p) => ({
      proveedor: p.proveedor,
      archivos: p.archivos.map((f) => f.name),
    })),
    null,
    2,
  )

  const userContent = `Requisitos documentales según los Términos de Referencia (JSON):\n${rej}\n\nArchivos efectivamente presentes en cada carpeta de cada proveedor en Google Drive (solo nombres de archivo):\n${ar}\n\nPara cada combinación (requisito_id, proveedor), indica qué archivo de la lista DE ESE PROVEedor corresponde a ese requisito. Si ningún archivo es claramente el indicado por el nombre o convenciones habituales, usa null para "archivo". El valor de "archivo" debe coincidir exactamente con un elemento de archivos[] de ese proveedor, o ser null.\n\nResponde solo este JSON válido:\n{\n  "asignaciones": [\n    {\n      "requisito_id": "string — uno de los id del primer JSON",\n      "proveedor": "string — exactamente como en segundo JSON",\n      "archivo": "string nombre exacto o null",\n      "confianza": "alta" | "media" | "baja"\n    }\n  ]\n}\nDebes incluir una fila por cada par (requisito_id × proveedor). Sin markdown ni texto adicional.`

  const { text } = await completeLlmText({
    user: userContent,
    system: 'Comparas nombres de archivos contra requisitos de licitaciones. Siempre respondes solo JSON válido.',
    label: `documentación (${args.requisitos.length} reqs × ${args.porProveedor.length} proveedores)`,
  })
  const json = extractJsonObject(text)
  const parsed = documentacionAsignacionesSchema.parse(json)
  const merged = ensureMatrizDocumentacion(args.requisitos, args.porProveedor, parsed.asignaciones)
  const valid = new Map(
    args.porProveedor.map((p) => [p.proveedor, new Set(p.archivos.map((f) => f.name))]),
  )
  const cleaned = merged.map((a) => {
    const ok = valid.get(a.proveedor)?.has(a.archivo ?? '') ?? false
    return ok ? a : { ...a, archivo: null, confianza: 'baja' as const }
  })
  return enrichAsignacionesWithFileIds(cleaned, args.porProveedor)
}

/** @deprecated Usar extractCriteriosFromTerminosDocument */
export async function extractCriteriosFromTerminosPdf(pdf: Buffer, title: string): Promise<CriterioRow[]> {
  return extractCriteriosFromTerminosDocument(pdf, title, 'application/pdf')
}

const MAX_PDFS_PER_PROVEEDOR = Number(process.env.COMPARAR_MAX_PDFS_PER_PROVEEDOR) || 4
const MAX_PDF_BYTES = Number(process.env.COMPARAR_MAX_PDF_BYTES) || 4 * 1024 * 1024

export function selectPdfsForIa(pdfs: { name: string; buffer: Buffer }[]): { name: string; buffer: Buffer }[] {
  const usable = pdfs.filter((p) => p.buffer.length <= MAX_PDF_BYTES)
  if (usable.length < pdfs.length) {
    console.warn(`[comparar] omitidos ${pdfs.length - usable.length} PDF(s) > ${MAX_PDF_BYTES} bytes`)
  }
  const picked = usable.slice(0, MAX_PDFS_PER_PROVEEDOR)
  if (picked.length < usable.length) {
    console.warn(`[comparar] usando ${picked.length}/${usable.length} PDF(s) por proveedor (límite ${MAX_PDFS_PER_PROVEEDOR})`)
  }
  return picked
}

export async function extractPropuestaFromPdfs(args: {
  proveedorNombre: string
  criterios: CriterioRow[]
  pdfBuffers: { name: string; buffer: Buffer }[]
}): Promise<PropuestaExtract> {
  const pdfs = selectPdfsForIa(args.pdfBuffers)
  if (pdfs.length === 0) {
    return { proveedor: args.proveedorNombre, nit: null, valores: [] }
  }
  const criterios_json = JSON.stringify(args.criterios, null, 2)
  const blocks: LlmUserBlock[] = []

  for (const p of pdfs) {
    blocks.push({
      type: 'pdf',
      filename: pdfAttachmentName(p.name),
      base64: p.buffer.toString('base64'),
    })
  }

  blocks.push({
    type: 'text',
    text: `Los criterios de evaluación de esta licitación son:
${criterios_json}

Lee la propuesta de ${args.proveedorNombre} (documento(s) adjuntos) y extrae el valor ofertado para cada criterio. Retorna este formato JSON:
{
  "proveedor": "string",
  "nit": "string o null si no aparece",
  "valores": [
    {
      "criterio": "string — nombre exacto del criterio",
      "valor_ofertado": "string — texto exacto del documento",
      "valor_numerico": number | null,
      "confianza": "alta" | "media" | "baja"
    }
  ]
}
Usa confianza baja si el valor no está explícito en el documento.
Responde solo JSON válido, sin markdown ni texto adicional.`,
  })

  const { text } = await completeLlmText({
    user: blocks,
    system: 'Eres un experto en análisis de propuestas comerciales. Siempre responde con JSON válido, sin texto adicional.',
    label: `propuesta ← ${args.proveedorNombre} (${pdfs.length} PDF)`,
  })
  const json = extractJsonObject(text)
  const parsed = propuestaExtractSchema.parse(json)
  const out = { ...parsed, proveedor: parsed.proveedor || args.proveedorNombre }
  return out
}

export async function scoreAndRankTop3(args: {
  criterios: CriterioRow[]
  propuestas: PropuestaExtract[]
}): Promise<z.infer<typeof scoringResponseSchema>> {
  const payload = {
    criterios: args.criterios,
    propuestas: args.propuestas,
  }
  const userContent = `Datos (JSON):
${JSON.stringify(payload, null, 2)}

Con los pesos de cada criterio (deben sumar 100), asigna a cada proveedor un puntaje global de 0 a 100.
Ordena de mayor a menor y construye "top_3" con los 3 mejores (si hay menos de 3, incluye todos).
Incluye una breve justificacion por proveedor en top_3 y en todas_las_propuestas.

Retorna exactamente este JSON (sin markdown, sin texto extra):
{
  "todas_las_propuestas": [
    { "proveedor": "string", "puntaje": 87.5, "valores": {}, "justificacion": "string" }
  ],
  "top_3": [
    { "proveedor": "string", "puntaje": 87.5, "valores": {}, "justificacion": "string" }
  ]
}
El campo "valores" puede ser un objeto resumen (ej. precio extraído, claves cortas).`

  const { text } = await completeLlmText({
    user: userContent,
    system: 'Eres un experto en evaluación de licitaciones en Colombia. Siempre responde con JSON válido, sin texto adicional.',
    label: `ranking (${args.propuestas.length} proveedores)`,
  })
  const json = extractJsonObject(text)
  return scoringResponseSchema.parse(json)
}

const analisisExtendidoSchema = z.object({
  analisis_criterios: z.array(
    z.object({
      criterio: z.string(),
      cobertura_tr: z.string(),
      condiciones_tr: z.string(),
      especificidad: z.string().optional().default(''),
      proveedores: z.array(
        z.object({
          proveedor: z.string(),
          puntaje_criterio: z.number(),
          bullets: z.array(z.string()),
        }),
      ),
    }),
  ),
  financiero: z.object({
    resumen: z.string(),
    comparativo: z.array(
      z.object({
        concepto: z.string(),
        valores_por_proveedor: z.record(z.string()),
      }),
    ),
    analisis_propuesta_economica: z.string(),
  }),
})

export type AnalisisExtendidoPayload = z.infer<typeof analisisExtendidoSchema>

function normKey(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

/** Asegura una fila por criterio del TR y una entrada por proveedor. */
export function mergeAnalisisExtendidoConCriterios(
  criterios: CriterioRow[],
  propuestas: PropuestaExtract[],
  raw: AnalisisExtendidoPayload,
): AnalisisExtendidoPayload {
  const provs = propuestas.map((p) => p.proveedor)
  const byCrit = new Map(raw.analisis_criterios.map((r) => [normKey(r.criterio), r]))
  const analisis_criterios = criterios.map((cr) => {
    const row = byCrit.get(normKey(cr.nombre))
    if (!row) {
      return {
        criterio: cr.nombre,
        cobertura_tr: 'No se generó detalle automático para este criterio.',
        condiciones_tr: cr.descripcion || '—',
        especificidad: `Tipo: ${cr.tipo}. Peso TR: ${cr.peso}%.`,
        proveedores: provs.map((proveedor) => ({
          proveedor,
          puntaje_criterio: 0,
          bullets: ['Pendiente de revisión manual o repetir comparación.'],
        })),
      }
    }
    const byProv = new Map(row.proveedores.map((x) => [normKey(x.proveedor), x]))
    const proveedores = provs.map((proveedor) => {
      const hit = byProv.get(normKey(proveedor))
      return (
        hit ?? {
          proveedor,
          puntaje_criterio: 0,
          bullets: ['Sin evaluación por criterio devuelta por el modelo.'],
        }
      )
    })
    return {
      ...row,
      criterio: cr.nombre,
      cobertura_tr: row.cobertura_tr || '—',
      condiciones_tr: row.condiciones_tr || cr.descripcion || '—',
      especificidad: row.especificidad ?? '',
      proveedores,
    }
  })
  return { ...raw, analisis_criterios }
}

/** Evaluación por criterio (cobertura, condiciones, bullets) + bloque financiero comparativo. */
export async function buildAnalisisExtendido(args: {
  criterios: CriterioRow[]
  propuestas: PropuestaExtract[]
}): Promise<AnalisisExtendidoPayload> {
  const payload = {
    criterios: args.criterios,
    propuestas: args.propuestas.map((p) => ({
      proveedor: p.proveedor,
      nit: p.nit,
      valores: p.valores,
    })),
  }
  const userContent = `Datos de la licitación (JSON):
${JSON.stringify(payload, null, 2)}

Tarea 1 — Análisis general por CRITERIO (uno por cada objeto en "criterios", en el mismo orden y usando el mismo "nombre" de criterio):
Para cada criterio del TR escribe:
- "cobertura_tr": qué debe cubrir el oferente según el TR (alcance / qué se evalúa).
- "condiciones_tr": condiciones o requisitos explícitos del TR vinculados a ese criterio (plazos, mínimos, forma de acreditar, etc.). Si no hay texto suficiente, indícalo brevemente.
- "especificidad": grado de detalle exigido por el TR y posibles ambigüedades (texto corto).

Para CADA proveedor en "propuestas" y ESE criterio:
- "puntaje_criterio": número de 0 a 10 (subpuntaje solo para ese criterio, coherente con el peso del criterio y lo ofertado).
- "bullets": array de 3 a 6 strings en español, cada uno una viñeta (sin prefijo "•"); deben cubrir: cobertura frente al TR, cumplimiento de condiciones y especificidad de la propuesta para ese criterio.

Tarea 2 — Financiero / propuesta económica:
- Identifica criterios con "tipo": "economico" y los valores extraídos por proveedor.
- "financiero.resumen": párrafo comparativo de la oferta económica entre proveedores.
- "financiero.comparativo": filas con "concepto" (nombre del criterio o subconcepto) y "valores_por_proveedor": objeto cuya clave es EXACTAMENTE el string "proveedor" de cada propuesta y el valor es el texto ofertado (valor_ofertado) o "—" si falta.
- "financiero.analisis_propuesta_economica": texto más detallado (riesgos, condiciones comerciales, unidades, coherencia). Si no hay criterios económicos, indícalo y resume con lo disponible.

Responde solo este JSON válido (sin markdown):
{
  "analisis_criterios": [
    {
      "criterio": "string — mismo nombre que en criterios[].nombre",
      "cobertura_tr": "string",
      "condiciones_tr": "string",
      "especificidad": "string",
      "proveedores": [
        { "proveedor": "string", "puntaje_criterio": 7.5, "bullets": ["texto viñeta 1", "texto viñeta 2"] }
      ]
    }
  ],
  "financiero": {
    "resumen": "string",
    "comparativo": [
      { "concepto": "string", "valores_por_proveedor": { "NombreProveedor": "texto" } }
    ],
    "analisis_propuesta_economica": "string"
  }
}`

  const label = `análisis extendido (${args.criterios.length} criterios × ${args.propuestas.length} proveedores)`
  const maxTok =
    Number(process.env.LLM_MAX_TOKENS_ANALISIS_EXTENDIDO) ||
    Number(process.env.ANTHROPIC_MAX_TOKENS_ANALISIS_EXTENDIDO) ||
    16384
  let lastErr: unknown
  let parsed: z.infer<typeof analisisExtendidoSchema> | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const repair =
      attempt === 0
        ? ''
        : `\n\n---\nCorrección: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}. Devuelve un único objeto JSON RFC 8259 válido (sin comas finales antes de ] o }, comillas dobles). Si la salida fue demasiado larga, acorta: 3–4 bullets por proveedor y criterio; cobertura_tr y condiciones_tr en una frase breve cada uno.`
    const { text } = await completeLlmText({
      user: userContent + repair,
      system: 'Eres experto en evaluación de licitaciones en Colombia. Respondes solo JSON válido, en español.',
      label: attempt === 0 ? label : `${label} (reintento)`,
      maxTokens: maxTok,
    })
    try {
      const json = extractJsonObject(text)
      parsed = analisisExtendidoSchema.parse(json)
      break
    } catch (e) {
      lastErr = e
      if (attempt === 1) throw e
      console.warn('[analisis-extendido] falló parse / esquema; reintentando una vez…', e)
    }
  }
  if (!parsed) throw new Error('análisis extendido sin resultado tras reintento')
  return mergeAnalisisExtendidoConCriterios(args.criterios, args.propuestas, parsed)
}
