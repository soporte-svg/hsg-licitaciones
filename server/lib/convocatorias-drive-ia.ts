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

const TR_PDF_TABLAS_HINT = `Este TR es un PDF: los criterios y documentos exigidos suelen estar en TABLAS o cuadros (matriz de evaluación, ponderación, %). Revisa todas las páginas y extrae filas/columnas completas; no te bases solo en párrafos de texto corrido. Si una tabla es imagen escaneada, interpreta los valores visibles con tu mejor esfuerzo.`

const CRITERIOS_PROMPT = `Lee este documento Términos de Referencia y extrae los criterios de evaluación (especialmente tablas o matrices de ponderación si existen). Retorna exactamente este formato JSON:
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
IMPORTANTE: la respuesta debe ser ÚNICAMENTE un objeto JSON; el primer carácter debe ser { y el último }. Sin markdown, sin texto antes ni después.`

const DOCUMENTOS_TR_PROMPT = `Identifica los DOCUMENTOS que deben allegar los proponentes según estos Términos de Referencia (anexos, formatos únicos (FUE), ítems de propuesta económica o jurada, experiencia, garantías, RUT/certificaciones tributarias y similares). Revisa también listas y tablas del PDF. No incluyas aquí los "criterios de evaluación" numéricos: solo ítems documentales allegables por el oferente.

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

function terminosPromptForMime(mimeType: string, prompt: string): string {
  if (mimeType === 'application/pdf') {
    return `${TR_PDF_TABLAS_HINT}\n\n${prompt}`
  }
  return prompt
}

const TERMINOS_SYSTEM_JSON =
  'Eres un experto en licitaciones públicas en Colombia. Respondes solo con un objeto JSON válido; el primer carácter de tu respuesta es {.'

const TERMINOS_SYSTEM_JSON_PDF =
  'Eres un experto en licitaciones públicas en Colombia. Lees PDFs con tablas y matrices de evaluación. Extraes datos de cuadros visibles. Respondes solo con un objeto JSON válido; el primer carácter de tu respuesta es {.'

async function buildTerminosUserContent(
  buffer: Buffer,
  title: string,
  mimeType: string,
  prompt: string,
): Promise<LlmUserContent> {
  const fullPrompt = terminosPromptForMime(mimeType, prompt)
  if (mimeType === 'application/pdf') {
    return [
      {
        type: 'pdf',
        filename: pdfAttachmentName(title),
        base64: buffer.toString('base64'),
      },
      { type: 'text', text: fullPrompt },
    ]
  }
  if (isDocxMime(mimeType) || title.toLowerCase().endsWith('.docx') || title.toLowerCase().endsWith('.doc')) {
    let plain = await docxToPlainText(buffer)
    if (plain.length > MAX_DOCX_CHARS) {
      console.warn(`[ia] términos truncados ${plain.length} → ${MAX_DOCX_CHARS} caracteres`)
      plain = `${plain.slice(0, MAX_DOCX_CHARS)}\n\n[… documento truncado por tamaño …]`
    }
    return [
      {
        type: 'text',
        text: `Documento: ${title}\n\n---\n${plain}\n---\n\n${fullPrompt}`,
      },
    ]
  }
  throw new Error(`Formato de términos no soportado: ${mimeType}. Usa .docx o .pdf.`)
}

async function completeLlmJsonObject(args: {
  user: LlmUserContent
  system: string
  label: string
  maxTokens?: number
}): Promise<unknown> {
  const user = args.user
  const maxTok =
    args.maxTokens ??
    (Number(process.env.LLM_MAX_TOKENS_CRITERIOS_TR) ||
      Number(process.env.ANTHROPIC_MAX_TOKENS_CRITERIOS_TR) ||
      12288)
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const repair =
      attempt === 0
        ? ''
        : '\n\n---\nTu respuesta anterior no fue JSON válido. Relee las TABLAS del PDF si los criterios están en una matriz. Devuelve ÚNICAMENTE un objeto JSON RFC 8259 (empieza con {). Sin markdown ni explicación.'
    const extraUser =
      typeof user === 'string'
        ? user + repair
        : [...user, ...(repair ? [{ type: 'text' as const, text: repair }] : [])]
    const { text, stopReason } = await completeLlmText({
      user: extraUser,
      system: args.system,
      label: attempt === 0 ? args.label : `${args.label} (reintento)`,
      maxTokens: maxTok,
    })
    if (stopReason === 'max_tokens' || stopReason === 'length') {
      console.warn(`[ia] ${args.label}: salida truncada (max_tokens=${maxTok})`)
    }
    try {
      return extractJsonObject(text)
    } catch (e) {
      lastErr = e
      const preview = text.replace(/\s+/g, ' ').slice(0, 320)
      console.warn(`[ia] JSON inválido en ${args.label} (intento ${attempt + 1}): ${preview}`)
      if (attempt === 1) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('JSON del modelo no parseable')
}

function parseCriteriosTerminosJson(json: unknown): z.infer<typeof terminosResponseSchema> {
  if (Array.isArray(json)) {
    return terminosResponseSchema.parse({ criterios: json, puntaje_total: 100 })
  }
  const o = json as Record<string, unknown>
  if (Array.isArray(o.criterios)) {
    return terminosResponseSchema.parse({
      criterios: o.criterios,
      puntaje_total: typeof o.puntaje_total === 'number' ? o.puntaje_total : 100,
    })
  }
  return terminosResponseSchema.parse(json)
}

export async function extractCriteriosFromTerminosDocument(
  buffer: Buffer,
  title: string,
  mimeType: string,
): Promise<CriterioRow[]> {
  const user = await buildTerminosUserContent(buffer, title, mimeType, CRITERIOS_PROMPT)
  const json = await completeLlmJsonObject({
    user,
    system: mimeType === 'application/pdf' ? TERMINOS_SYSTEM_JSON_PDF : TERMINOS_SYSTEM_JSON,
    label: `criterios ← ${title}`,
  })
  const parsed = parseCriteriosTerminosJson(json)
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
  const user = await buildTerminosUserContent(buffer, title, mimeType, DOCUMENTOS_TR_PROMPT)
  const json = await completeLlmJsonObject({
    user,
    system: mimeType === 'application/pdf' ? TERMINOS_SYSTEM_JSON_PDF : TERMINOS_SYSTEM_JSON,
    label: `documentos TR ← ${title}`,
  })
  const parsed = terminosDocListSchema.parse(json)
  return parsed.documentos
}

const CRITERIOS_TEXTO_PROMPT = `${CRITERIOS_PROMPT}\n\nEl usuario pegó el texto de los términos de referencia (puede incluir tablas en texto plano). Extrae los criterios con la mayor precisión posible.`

const DOCUMENTOS_TEXTO_PROMPT = `${DOCUMENTOS_TR_PROMPT}\n\nTexto pegado por el usuario (sin archivo adjunto).`

export async function extractCriteriosFromTerminosText(texto: string): Promise<CriterioRow[]> {
  const trimmed = texto.trim()
  const user = `Términos de referencia (texto pegado):\n\n---\n${trimmed.slice(0, MAX_DOCX_CHARS)}\n---\n\n${CRITERIOS_TEXTO_PROMPT}`
  const json = await completeLlmJsonObject({
    user,
    system: TERMINOS_SYSTEM_JSON,
    label: 'criterios ← texto TR',
  })
  return parseCriteriosTerminosJson(json).criterios
}

export async function extractDocumentosFromTerminosText(texto: string): Promise<RequisitoDocumentoTr[]> {
  const trimmed = texto.trim()
  const user = `Términos de referencia (texto pegado):\n\n---\n${trimmed.slice(0, MAX_DOCX_CHARS)}\n---\n\n${DOCUMENTOS_TEXTO_PROMPT}`
  const json = await completeLlmJsonObject({
    user,
    system: TERMINOS_SYSTEM_JSON,
    label: 'documentos TR ← texto',
  })
  const parsed = terminosDocListSchema.parse(json)
  return parsed.documentos
}

export function normalizeCriteriosManual(rows: CriterioRow[]): CriterioRow[] {
  const cleaned = rows
    .map((r) => ({
      nombre: r.nombre.trim(),
      descripcion: (r.descripcion ?? '').trim() || r.nombre.trim(),
      peso: Number(r.peso),
      tipo: r.tipo,
      unidad: (r.unidad ?? '').trim(),
    }))
    .filter((r) => r.nombre.length > 0)
  if (cleaned.length === 0) return []
  const sum = cleaned.reduce((s, c) => s + c.peso, 0)
  if (sum > 0 && Math.abs(sum - 100) > 2) {
    const factor = 100 / sum
    return cleaned.map((c) => ({ ...c, peso: Math.round(c.peso * factor * 10) / 10 }))
  }
  return cleaned
}

const clarificacionEvalSchema = z.object({
  confianza_pct: z.number().min(0).max(100),
  preguntas: z.array(
    z.object({
      id: z.string(),
      pregunta: z.string(),
      contexto: z.string().optional(),
    }),
  ),
  advertencias: z.array(z.string()).optional().default([]),
})

function confianzaBaseHeuristica(
  fuente: 'drive' | 'texto' | 'manual',
  criterios: CriterioRow[],
): number {
  if (fuente === 'manual') {
    const complete = criterios.every((c) => c.nombre.trim() && c.descripcion.trim() && c.peso > 0)
    const sum = criterios.reduce((s, c) => s + c.peso, 0)
    if (complete && criterios.length >= 2 && Math.abs(sum - 100) <= 2) return 94
    if (criterios.length >= 2) return 76
    return 48
  }
  if (fuente === 'texto') {
    return criterios.length >= 3 ? 82 : criterios.length >= 1 ? 72 : 40
  }
  return criterios.length >= 2 ? 88 : 52
}

const CLARIFICACION_SYSTEM =
  'Eres un asistente de licitaciones HSG. Evalúas si hay ambigüedad antes de comparar propuestas. Respondes solo JSON válido.'

export async function evaluarConfianzaYClarificacion(args: {
  servicio: string
  fuente_terminos: 'drive' | 'texto' | 'manual'
  criterios: CriterioRow[]
  terminos_texto?: string
  clarificaciones?: { id: string; pregunta?: string; respuesta: string }[]
  flywheelAppendix?: string
}): Promise<{
  confianza_pct: number
  preguntas: { id: string; pregunta: string; contexto?: string }[]
  advertencias: string[]
}> {
  const base = confianzaBaseHeuristica(args.fuente_terminos, args.criterios)
  const respuestas = args.clarificaciones ?? []
  const bonus = Math.min(24, respuestas.length * 12)

  const clarText =
    respuestas.length > 0
      ? respuestas.map((c) => `• ${c.pregunta ?? c.id}: ${c.respuesta}`).join('\n')
      : '(ninguna aún)'

  const user = `Servicio/carpeta: ${args.servicio}
Fuente de términos: ${args.fuente_terminos}
Criterios propuestos (${args.criterios.length}):
${JSON.stringify(args.criterios, null, 2)}

Fragmento TR pegado (si aplica, primeros 2500 caracteres):
${(args.terminos_texto ?? '').slice(0, 2500)}

Respuestas del usuario a preguntas previas:
${clarText}
${args.flywheelAppendix ?? ''}

Instrucciones:
1. Estima confianza_pct (0-100) de que entendemos QUÉ evaluar y CÓMO (pesos, unidades, periodicidad económica).
2. Si confianza_pct < 90, genera entre 1 y 5 preguntas concretas (id único snake_case) para eliminar ambigüedad. NO supongas: pregunta.
3. Si el usuario ya respondió y eso aclara la duda, sube confianza y reduce preguntas.
4. Si fuente=manual y criterios están completos y pesos ~100, confianza puede ser >= 92 sin preguntas.

JSON:
{
  "confianza_pct": number,
  "preguntas": [{ "id": "string", "pregunta": "string", "contexto": "string opcional" }],
  "advertencias": ["string"]
}`

  try {
    const json = await completeLlmJsonObject({
      user,
      system: CLARIFICACION_SYSTEM,
      label: 'clarificación confianza',
      maxTokens: 4096,
    })
    const parsed = clarificacionEvalSchema.parse(json)
    let confianza_pct = Math.round(Math.max(parsed.confianza_pct, base + bonus))
    confianza_pct = Math.min(100, confianza_pct)
    const preguntas =
      confianza_pct < 90 ? parsed.preguntas.filter((p) => p.pregunta.trim().length > 0).slice(0, 5) : []
    return { confianza_pct, preguntas, advertencias: parsed.advertencias }
  } catch (e) {
    console.warn('[ia] clarificación fallback:', e)
    const preguntas: { id: string; pregunta: string; contexto?: string }[] = []
    if (confianzaBaseHeuristica(args.fuente_terminos, args.criterios) + bonus < 90) {
      if (args.criterios.some((c) => c.tipo === 'economico' && !/mes|mensual|año|anual|total/i.test(c.unidad))) {
        preguntas.push({
          id: 'periodicidad_economica',
          pregunta: '¿El criterio económico se evalúa en valor mensual, anual o valor total del contrato?',
          contexto: 'Evita comparar cifras incompatibles entre proveedores.',
        })
      }
      if (args.fuente_terminos === 'texto') {
        preguntas.push({
          id: 'confirmar_criterios',
          pregunta: '¿Los criterios y pesos listados coinciden con la matriz oficial del TR?',
        })
      }
      if (args.criterios.length < 2) {
        preguntas.push({
          id: 'criterios_minimos',
          pregunta: '¿Qué criterios adicionales del TR debemos incluir (nombre y peso %)?',
        })
      }
    }
    return {
      confianza_pct: Math.min(100, base + bonus),
      preguntas,
      advertencias: ['Evaluación de confianza por reglas (modelo no disponible).'],
    }
  }
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

  const userContent = `Requisitos documentales según los Términos de Referencia (JSON):\n${rej}\n\nArchivos efectivamente presentes en cada carpeta de cada proveedor en Google Drive (solo nombres de archivo):\n${ar}\n\nPara cada combinación (requisito_id, proveedor), indica qué archivo de la lista DE ESE PROVEedor corresponde a ese requisito.\n\nReglas importantes (licitaciones Colombia):\n- Muchos requisitos (pólizas de garantía, RUT, cámara de comercio, estados financieros, certificaciones) van DENTRO del PDF de propuesta/oferta/comercial, no como archivos sueltos con nombre explícito.\n- Si no hay un archivo cuyo nombre coincida con el requisito pero sí existe un PDF de propuesta/oferta/comercial/servicios del proveedor, asigna ESE archivo con confianza "media" y en "nota" escribe brevemente: "Incluido en propuesta/oferta (verificar en el PDF)".\n- Para pólizas y garantías contractuales, prioriza el PDF de propuesta comercial u oferta de servicios si no hay archivo separado de póliza.\n- Solo usa null si no hay ningún candidato razonable (ni propuesta ni archivo temático).\n\nEl valor de "archivo" debe coincidir exactamente con un elemento de archivos[] de ese proveedor, o ser null.\n\nResponde solo este JSON válido:\n{\n  "asignaciones": [\n    {\n      "requisito_id": "string — uno de los id del primer JSON",\n      "proveedor": "string — exactamente como en segundo JSON",\n      "archivo": "string nombre exacto o null",\n      "confianza": "alta" | "media" | "baja",\n      "nota": "string opcional — ej. incluido en propuesta"\n    }\n  ]\n}\nDebes incluir una fila por cada par (requisito_id × proveedor). Sin markdown ni texto adicional.`

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

const MAX_PDFS_PER_PROVEEDOR = Number(process.env.COMPARAR_MAX_PDFS_PER_PROVEEDOR) || 6
const MAX_PDF_BYTES = Number(process.env.COMPARAR_MAX_PDF_BYTES) || 4 * 1024 * 1024

/** Prioriza propuesta/oferta comercial antes de certificados sueltos (límite de PDFs por proveedor). */
export function sortArchivosByPropuestaPriority<T extends { name: string }>(files: T[]): T[] {
  if (files.length === 0) return []
  const ranked = prioritizePdfsForIa(files.map((f) => ({ name: f.name, buffer: Buffer.alloc(1) })))
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of ranked) {
    const hit = files.find((f) => f.name === r.name)
    if (hit && !seen.has(hit.name)) {
      seen.add(hit.name)
      out.push(hit)
    }
  }
  for (const f of files) {
    if (!seen.has(f.name)) out.push(f)
  }
  return out
}

export function prioritizePdfsForIa(pdfs: { name: string; buffer: Buffer }[]): { name: string; buffer: Buffer }[] {
  const score = (name: string): number => {
    const n = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (/propuesta|oferta|comercial|economica|economico|fue|precio|cotizaci|servicio/.test(n)) return 100
    if (/acqua|conjunto|ph\b|residencial/.test(n)) return 60
    if (/poliz|garant|seguro/.test(n)) return 40
    if (/estado.?financ|rut\b|camara|certif|experiencia/.test(n)) return 25
    if (/cedula|arl|sg-sst|manual|declaracion/.test(n)) return 10
    return 0
  }
  return [...pdfs].sort((a, b) => score(b.name) - score(a.name) || a.name.localeCompare(b.name))
}

export function selectPdfsForIa(pdfs: { name: string; buffer: Buffer }[]): { name: string; buffer: Buffer }[] {
  const usable = prioritizePdfsForIa(pdfs.filter((p) => p.buffer.length <= MAX_PDF_BYTES))
  if (usable.length < pdfs.length) {
    const omitted = pdfs.length - pdfs.filter((p) => p.buffer.length <= MAX_PDF_BYTES).length
    if (omitted > 0) {
      console.warn(`[comparar] omitidos ${omitted} PDF(s) > ${MAX_PDF_BYTES} bytes`)
    }
  }
  const picked = usable.slice(0, MAX_PDFS_PER_PROVEEDOR)
  if (picked.length < usable.length) {
    console.warn(
      `[comparar] usando ${picked.length}/${usable.length} PDF(s) por proveedor (límite ${MAX_PDFS_PER_PROVEEDOR}): ${picked.map((p) => p.name).join(' | ')}`,
    )
  }
  return picked
}

export async function extractPropuestaFromPdfs(args: {
  proveedorNombre: string
  criterios: CriterioRow[]
  pdfBuffers: { name: string; buffer: Buffer }[]
  contextoAprendizaje?: string
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
      "valor_ofertado": "string — texto del documento; para criterios económicos incluye SIEMPRE la periodicidad explícita (ej. \"MENSUAL: $34.190.000\" o \"ANUAL/TOTAL CONTRATO: $392.125.044\")",
      "valor_numerico": number | null,
      "confianza": "alta" | "media" | "baja"
    }
  ]
}
Reglas de extracción:
- Para cada criterio con "tipo": "economico", busca tablas y totales de propuesta económica aunque estén en imágenes o cuadros dentro del PDF; indica en valor_ofertado si el monto es mensual, anual o total del contrato.
- Si el monto solo aparece en una tabla/gráfico y no es legible con certeza, usa confianza "baja" y describe lo que sí ves.
- Usa confianza baja si el valor no está explícito en ningún documento adjunto.
- Incluye una fila por cada criterio del TR aunque no haya dato (valor_ofertado: "No encontrado en los PDF analizados", confianza: "baja").
${args.contextoAprendizaje ?? ''}
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

Con los pesos de cada criterio (deben sumar 100), asigna a cada proveedor un puntaje global de 0 a 100 usando SOLO los valores en propuestas[].valores alineados a cada criterio del TR (nombre, peso, unidad, tipo).
Ordena de mayor a menor y construye "top_3" con los 3 mejores (si hay menos de 3, incluye todos).

"justificacion" (obligatorio, específico, 4–8 oraciones por proveedor):
- Enumera CADA criterio del TR con su peso %, el valor_ofertado extraído (o "sin dato"), la confianza de extracción (alta|media|baja) y por qué suma o resta al puntaje.
- Prohibido texto genérico ("buena experiencia", "falta confianza en criterios técnicos", "baja confianza en algunos valores") sin nombrar el criterio y el dato concreto.
- Si falta valor o confianza baja en un criterio con alto peso, dilo explícitamente (ej. "Precios (20%): sin dato, confianza baja → penalización").

Retorna exactamente este JSON (sin markdown, sin texto extra):
{
  "todas_las_propuestas": [
    { "proveedor": "string", "puntaje": 87.5, "valores": {}, "justificacion": "string detallado" }
  ],
  "top_3": [
    { "proveedor": "string", "puntaje": 87.5, "valores": {}, "justificacion": "string detallado" }
  ]
}
El campo "valores" puede ser un objeto resumen breve (ej. clave = nombre criterio, valor = texto ofertado).`

  const { text } = await completeLlmText({
    user: userContent,
    system: 'Eres un experto en evaluación de licitaciones en Colombia. Siempre responde con JSON válido, sin texto adicional.',
    label: `ranking (${args.propuestas.length} proveedores)`,
  })
  const json = extractJsonObject(text)
  return scoringResponseSchema.parse(json)
}

const confianzaExtraccionSchema = z.enum(['alta', 'media', 'baja'])

const analisisProveedorCriterioSchema = z.object({
  proveedor: z.string(),
  puntaje_criterio: z.number(),
  valor_ofertado: z.string().optional().default('—'),
  confianza_extraccion: confianzaExtraccionSchema.nullable().optional(),
  bullets: z.array(z.string()),
})

const analisisExtendidoSchema = z.object({
  resumen_ejecutivo: z
    .object({
      sintesis_global: z.string(),
      proveedores: z.array(
        z.object({
          proveedor: z.string(),
          puntaje_global: z.number().nullable().optional(),
          veredicto: z.string(),
          por_criterio: z.array(
            z.object({
              criterio: z.string(),
              peso_pct: z.number(),
              medicion_tr: z.string(),
              valor_ofertado: z.string(),
              confianza_extraccion: confianzaExtraccionSchema.nullable().optional(),
              subpuntaje_10: z.number(),
              hallazgo: z.string(),
            }),
          ),
        }),
      ),
    })
    .optional(),
  analisis_criterios: z.array(
    z.object({
      criterio: z.string(),
      medicion_tr: z.string().optional().default(''),
      peso_pct: z.number().optional(),
      tipo_criterio: z.string().optional().default(''),
      cobertura_tr: z.string(),
      condiciones_tr: z.string(),
      especificidad: z.string().optional().default(''),
      proveedores: z.array(analisisProveedorCriterioSchema),
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

function medicionTrFromCriterio(cr: CriterioRow): string {
  const parts = [cr.unidad?.trim(), cr.descripcion?.trim()].filter(Boolean)
  return parts.length > 0 ? parts.join(' — ') : 'Según TR (sin unidad explícita)'
}

function extraccionPorCriterio(propuesta: PropuestaExtract | undefined, nombreCriterio: string) {
  if (!propuesta?.valores?.length) {
    return { valor_ofertado: 'No encontrado en los PDF analizados', confianza_extraccion: 'baja' as const }
  }
  const hit =
    propuesta.valores.find((v) => normKey(v.criterio) === normKey(nombreCriterio)) ??
    propuesta.valores.find((v) => normKey(nombreCriterio).includes(normKey(v.criterio)))
  if (!hit) {
    return { valor_ofertado: 'No encontrado en los PDF analizados', confianza_extraccion: 'baja' as const }
  }
  return {
    valor_ofertado: hit.valor_ofertado?.trim() || '—',
    confianza_extraccion: hit.confianza ?? null,
  }
}

/** Asegura una fila por criterio del TR y una entrada por proveedor. */
export function mergeAnalisisExtendidoConCriterios(
  criterios: CriterioRow[],
  propuestas: PropuestaExtract[],
  raw: AnalisisExtendidoPayload,
): AnalisisExtendidoPayload {
  const provs = propuestas.map((p) => p.proveedor)
  const propByName = new Map(propuestas.map((p) => [normKey(p.proveedor), p]))
  const byCrit = new Map(raw.analisis_criterios.map((r) => [normKey(r.criterio), r]))
  const analisis_criterios = criterios.map((cr) => {
    const medicion_tr = medicionTrFromCriterio(cr)
    const row = byCrit.get(normKey(cr.nombre))
    if (!row) {
      return {
        criterio: cr.nombre,
        medicion_tr,
        peso_pct: cr.peso,
        tipo_criterio: cr.tipo,
        cobertura_tr: 'No se generó detalle automático para este criterio.',
        condiciones_tr: cr.descripcion || '—',
        especificidad: `Peso TR: ${cr.peso}%.`,
        proveedores: provs.map((proveedor) => {
          const ext = extraccionPorCriterio(propByName.get(normKey(proveedor)), cr.nombre)
          return {
            proveedor,
            puntaje_criterio: 0,
            ...ext,
            bullets: ['Pendiente de revisión manual o repetir comparación.'],
          }
        }),
      }
    }
    const byProv = new Map(row.proveedores.map((x) => [normKey(x.proveedor), x]))
    const proveedores = provs.map((proveedor) => {
      const ext = extraccionPorCriterio(propByName.get(normKey(proveedor)), cr.nombre)
      const hit = byProv.get(normKey(proveedor))
      if (!hit) {
        return {
          proveedor,
          puntaje_criterio: 0,
          ...ext,
          bullets: ['Sin evaluación por criterio devuelta por el modelo.'],
        }
      }
      return {
        ...hit,
        proveedor,
        valor_ofertado: hit.valor_ofertado?.trim() || ext.valor_ofertado,
        confianza_extraccion: hit.confianza_extraccion ?? ext.confianza_extraccion,
      }
    })
    return {
      ...row,
      criterio: cr.nombre,
      medicion_tr: row.medicion_tr?.trim() || medicion_tr,
      peso_pct: row.peso_pct ?? cr.peso,
      tipo_criterio: row.tipo_criterio || cr.tipo,
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

REGLA DE ORO — Homogeneidad y criterios del TR:
- Solo existen ${args.criterios.length} criterios de evaluación (los de "criterios[]"). NO inventes subcriterios ni evalúes temas ajenos (certificados comerciales de otros clientes, hoja de vida, RUT, pólizas, etc.) salvo que el TR los vincule explícitamente a ESE criterio por nombre/descripcion/unidad.
- Para cada criterio usa "nombre", "descripcion", "unidad", "tipo" y "peso" del TR como marco único de medición.
- En cada proveedor usa el valor en propuestas[].valores cuyo "criterio" coincida con el nombre del TR; copia "valor_ofertado" y "confianza" a "valor_ofertado" y "confianza_extraccion".

Tarea 1 — Análisis por CRITERIO del TR (exactamente uno por cada criterios[], mismo orden y mismo "nombre"):
Por criterio incluye:
- "medicion_tr": cómo se mide según TR (repite/unifica "unidad" + forma de evaluar en "descripcion").
- "peso_pct" y "tipo_criterio": del TR.
- "cobertura_tr": qué debe demostrar el oferente para este criterio.
- "condiciones_tr": mínimos/plazos/forma de acreditar según TR.
- "especificidad": qué nivel de detalle exige el TR para este criterio.

Por CADA proveedor y ESE criterio:
- "valor_ofertado" y "confianza_extraccion": de la extracción (o "No encontrado…", baja).
- "puntaje_criterio": 0–10 según cumplimiento frente a medicion_tr y condiciones_tr (no por textos genéricos de otros documentos).
- "bullets": 3–5 viñetas concretas. Cada viñeta DEBE mencionar: (1) criterio/medición TR, (2) valor ofertado citado, (3) confianza de extracción, (4) conclusión de cumplimiento. Ejemplo válido: "Personal (medición: número de empleados): oferta «8 auxiliares…» (confianza alta); cumple cantidad explícita." Ejemplo inválido: "Menciona compromiso con trabajadores" (no es la unidad del TR).

Tarea 1b — Resumen ejecutivo (unificado con el análisis anterior, misma lógica):
- "resumen_ejecutivo.sintesis_global": párrafo comparando proveedores citando criterios con mayor peso y datos faltantes.
- "resumen_ejecutivo.proveedores": una entrada por cada proveedor en "propuestas", con:
  - "veredicto": 3–5 oraciones específicas (fortalezas/debilidades por criterio con peso, valores y confianza; sin frases vacías).
  - "por_criterio": una fila por cada criterio del TR con peso_pct, medicion_tr, valor_ofertado, confianza_extraccion, subpuntaje_10 (igual a puntaje_criterio) y "hallazgo" (una frase concluyente).

Tarea 2 — Financiero / propuesta económica:
- Identifica criterios con "tipo": "economico" y los valores extraídos por proveedor.
- NO compares montos de distinta periodicidad como si fueran equivalentes: si uno es mensual y otro anual/total contrato, indícalo claramente en cada celda y en el resumen.
- Cuando sea posible, añade filas en "financiero.comparativo" separando periodicidad (ej. concepto "Precio — periodicidad declarada", "Precio — valor mensual estimado" solo si puedes inferirlo con certeza razonable del texto).
- "financiero.resumen": párrafo comparativo; advierte explícitamente si faltan datos (ej. BIO ASEO sin extracción) o si hay órdenes de magnitud distintos (mensual vs total contrato).
- "financiero.comparativo": filas con "concepto" y "valores_por_proveedor": clave EXACTAMENTE el string "proveedor" de cada propuesta; valor = texto ofertado (valor_ofertado) o "—" si falta.
- "financiero.analisis_propuesta_economica": riesgos, condiciones comerciales, unidades, coherencia y limitaciones de lectura (tablas escaneadas/imagen). Si no hay criterios económicos, indícalo.

Responde solo este JSON válido (sin markdown):
{
  "resumen_ejecutivo": {
    "sintesis_global": "string",
    "proveedores": [
      {
        "proveedor": "string",
        "puntaje_global": null,
        "veredicto": "string",
        "por_criterio": [
          {
            "criterio": "string",
            "peso_pct": 20,
            "medicion_tr": "string",
            "valor_ofertado": "string",
            "confianza_extraccion": "alta",
            "subpuntaje_10": 7.5,
            "hallazgo": "string"
          }
        ]
      }
    ]
  },
  "analisis_criterios": [
    {
      "criterio": "string — mismo nombre que en criterios[].nombre",
      "medicion_tr": "string",
      "peso_pct": 20,
      "tipo_criterio": "tecnico",
      "cobertura_tr": "string",
      "condiciones_tr": "string",
      "especificidad": "string",
      "proveedores": [
        {
          "proveedor": "string",
          "puntaje_criterio": 7.5,
          "valor_ofertado": "string",
          "confianza_extraccion": "alta",
          "bullets": ["viñeta concreta 1"]
        }
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
