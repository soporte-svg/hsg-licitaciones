import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { getDriveRootFolderId } from '../lib/drive-config.js'
import { getDrive } from '../lib/lazy-drive.js'
import { enrichAsignacionesWithFileIds } from '../lib/documentacion-enrich.js'
import { getConvocatoriasIa } from '../lib/lazy-ia.js'
import {
  fingerprintDocumentosRequeridos,
  fingerprintDrivePorServicio,
  fingerprintPdfIds,
  loadAnalisisIaCache,
  saveAnalisisIaCache,
  type ProveedorExtraccionCache,
} from '../lib/analisis-ia-cache.js'
import {
  compararTerminosInputSchema,
  CONFIANZA_UMBRAL,
  resolveCriteriosYDocumentos,
  runPreparacionComparar,
} from '../lib/comparar-terminos.js'
import { formatFlywheelPromptAppendix, loadFlywheelContext, saveFlywheelEntry } from '../lib/flywheel-aprendizaje.js'

const router = new Hono()

const textoTrBodySchema = z.object({
  terminos_texto: z.string().min(80),
})

const flywheelBodySchema = z.object({
  folder_id: z.string().optional(),
  servicio: z.string().optional(),
  conjunto: z.string().optional(),
  tipo: z.enum([
    'clarificacion',
    'correccion_criterio',
    'correccion_extraccion',
    'nota_endir',
    'calificacion_analisis',
  ]),
  payload: z.record(z.unknown()),
  calificacion_endir: z.number().int().min(1).max(5).optional(),
})

router.get('/folders', requireAuth, async (c) => {
  try {
    const drive = await getDrive()
    const parentId = c.req.query('parent_id')?.trim() || getDriveRootFolderId()
    const folders = await drive.listChildren(parentId).then((raw) =>
      raw
        .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.id && f.name)
        .map((f) => ({ id: f.id!, name: f.name!, type: 'folder' as const })),
    )
    return c.json({ folders })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error listando Drive.'
    return c.json({ data: null, error: { code: 'DRIVE_ERROR', message: msg } }, 500)
  }
})

router.get('/browse', requireAuth, async (c) => {
  try {
    const drive = await getDrive()
    const parentId = c.req.query('parent_id')?.trim() || getDriveRootFolderId()
    const raw = await drive.listChildren(parentId)
    const folders = raw
      .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.id && f.name)
      .map((f) => ({ id: f.id!, name: f.name!, type: 'folder' as const }))
    const files = raw
      .filter((f) => f.mimeType === 'application/pdf' && f.id && f.name)
      .map((f) => ({ id: f.id!, name: f.name!, type: 'pdf' as const }))
    return c.json({ folders, files })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error listando Drive.'
    return c.json({ data: null, error: { code: 'DRIVE_ERROR', message: msg } }, 500)
  }
})

router.get('/pdf', requireAuth, async (c) => {
  const fileId = c.req.query('file_id')?.trim()
  if (!fileId) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'file_id requerido' } }, 400)
  }
  try {
    const drive = await getDrive()
    const { buffer, name, mimeType } = await drive.downloadFileBuffer(fileId)
    if (mimeType !== 'application/pdf') {
      return c.json(
        { data: null, error: { code: 'NOT_PDF', message: `El archivo no es PDF (${mimeType}).` } },
        400,
      )
    }
    const safeName = name.replace(/[^\w.\- ]+/g, '_').slice(0, 120)
    return c.body(new Uint8Array(buffer), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error descargando archivo.'
    return c.json({ data: null, error: { code: 'DRIVE_ERROR', message: msg } }, 500)
  }
})

/** Listado ligero para el home: últimos análisis del usuario (todas las carpetas). */
router.get('/analisis-recientes', requireAuth, async (c) => {
  const userEmail = c.get('userEmail')
  if (!userEmail) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'Usuario sin email' } }, 400)
  }
  const limRaw = Number(c.req.query('limit'))
  const limit = Number.isFinite(limRaw) ? Math.min(100, Math.max(1, Math.floor(limRaw))) : 30

  const { data, error } = await supabaseAdmin
    .from('analisis')
    .select('id, folder_id, conjunto, servicio, anio, created_at, top_3')
    .eq('created_by', userEmail)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return c.json({ data: null, error: { code: 'DB_ERROR', message: error.message } }, 500)
  }
  return c.json({ data, error: null })
})

router.get('/analisis', requireAuth, async (c) => {
  const folderId = c.req.query('folder_id')?.trim()
  if (!folderId) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'folder_id requerido' } }, 400)
  }
  const { data, error } = await supabaseAdmin
    .from('analisis')
    .select('id, folder_id, conjunto, servicio, anio, created_at, created_by')
    .eq('folder_id', folderId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return c.json({ data: null, error: { code: 'DB_ERROR', message: error.message } }, 500)
  }
  return c.json({ data, error: null })
})

router.get('/analisis/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { data, error } = await supabaseAdmin.from('analisis').select('*').eq('id', id).single()
  if (error || !data) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Análisis no encontrado' } }, 404)
  }
  return c.json({ data, error: null })
})

router.get('/analisis/:id/informe-pdf', requireAuth, async (c) => {
  const id = c.req.param('id')
  try {
    const { buildInformeComparativoPdf, informePdfFilename } = await import('../lib/informe-comparativo-pdf.js')
    const { data, error } = await supabaseAdmin.from('analisis').select('*').eq('id', id).single()
    if (error || !data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Análisis no encontrado' } }, 404)
    }
    const buffer = await buildInformeComparativoPdf(data)
    const filename = informePdfFilename(data)
    return c.body(new Uint8Array(buffer), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error generando informe PDF'
    console.error('[informe-pdf]', e)
    return c.json({ data: null, error: { code: 'INFORME_PDF_ERROR', message: msg } }, 500)
  }
})

router.get('/terminos', requireAuth, async (c) => {
  const folderId = c.req.query('folder_id')?.trim()
  if (!folderId) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'folder_id requerido' } }, 400)
  }
  try {
    const drive = await getDrive()
    const terminos = await drive.findTerminosFileForServiceFolder(folderId)
    if (!terminos) {
      return c.json({
        data: null,
        error: {
          code: 'NO_TERMINOS',
          message:
            'No hay términos en la carpeta central para este servicio. Se buscan PDF o Word como «TR HSG (NombreServicio).docx» o «TR HSG - NombreServicio.pdf» según el nombre de la carpeta (ej. carpeta TUBERIA → TR con «Tuberia» en el nombre).',
        },
      })
    }
    return c.json({ data: { id: terminos.id, name: terminos.name }, error: null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error buscando términos.'
    return c.json({ data: null, error: { code: 'DRIVE_ERROR', message: msg } }, 500)
  }
})

function compararLog(msg: string) {
  console.log(`[comparar] ${msg}`)
}

/** Subcarpeta proveedor o un PDF suelto en la carpeta de servicio (un PDF = un oferente). */
type ProveedorFuente = {
  id: string
  name: string
  layout: 'folder' | 'pdf-en-servicio'
  pdfFileName: string
}

function proveedorLabelFromPdfName(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '').trim()
  return base || filename
}

function resolveProveedoresFuentes(
  raw: Awaited<ReturnType<Awaited<ReturnType<typeof getDrive>>['listChildren']>>,
): ProveedorFuente[] {
  const subfolders = raw
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      layout: 'folder' as const,
      pdfFileName: '',
    }))

  if (subfolders.length > 0) return subfolders

  return raw
    .filter((f) => f.mimeType === 'application/pdf' && f.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: proveedorLabelFromPdfName(f.name!),
      layout: 'pdf-en-servicio' as const,
      pdfFileName: f.name!,
    }))
}

router.post(
  '/extraer-criterios-texto',
  requireAuth,
  zValidator('json', textoTrBodySchema),
  async (c) => {
    const { terminos_texto } = c.req.valid('json')
    try {
      const ia = await getConvocatoriasIa()
      const [criterios, documentos] = await Promise.all([
        ia.extractCriteriosFromTerminosText(terminos_texto),
        ia.extractDocumentosFromTerminosText(terminos_texto),
      ])
      return c.json({ criterios, documentos, error: null })
    } catch (e: unknown) {
      const ia = await getConvocatoriasIa()
      const msg = ia.formatAnthropicError(e)
      return c.json({ criterios: null, documentos: null, error: { code: 'EXTRACCION_ERROR', message: msg } }, 502)
    }
  },
)

router.post(
  '/preparar-comparar',
  requireAuth,
  zValidator('json', compararTerminosInputSchema),
  async (c) => {
    const input = c.req.valid('json')
    const userEmail = c.get('userEmail')
    try {
      const drive = await getDrive()
      const ia = await getConvocatoriasIa()
      const iaCache = await loadAnalisisIaCache(input.folder_id)
      const prep = await runPreparacionComparar({
        input,
        drive,
        ia,
        iaCache,
        userEmail,
      })
      return c.json({ ...prep, error: null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error preparando comparación.'
      return c.json({ error: { code: 'PREPARAR_ERROR', message: msg } }, 400)
    }
  },
)

router.post('/flywheel', requireAuth, zValidator('json', flywheelBodySchema), async (c) => {
  const body = c.req.valid('json')
  const userEmail = c.get('userEmail')
  await saveFlywheelEntry({
    folder_id: body.folder_id ?? null,
    servicio: body.servicio ?? null,
    conjunto: body.conjunto ?? null,
    tipo: body.tipo,
    payload: body.payload as Record<string, unknown>,
    calificacion_endir: body.calificacion_endir ?? null,
    created_by: userEmail,
  })
  return c.json({ ok: true })
})

router.post('/comparar', requireAuth, zValidator('json', compararTerminosInputSchema), async (c) => {
  const input = c.req.valid('json')
  const folderId = input.folder_id
  const userEmail = c.get('userEmail')
  const t0 = Date.now()
  const ia = await getConvocatoriasIa()
  const drive = await getDrive()

  try {
    compararLog(`inicio folder=${folderId} fuente=${input.fuente_terminos}`)

    const rawChildren = await drive.listChildren(folderId)
    const proveedorFuentes = resolveProveedoresFuentes(rawChildren)
    const proveedorFolders = proveedorFuentes.map((p) => ({ id: p.id, name: p.name }))

    if (proveedorFuentes.length === 0) {
      return c.json(
        {
          data: null,
          error: {
            code: 'NO_PROVEEDORES',
            message:
              'No hay propuestas para comparar. Crea una subcarpeta por proveedor con sus PDFs dentro, o deja un PDF por oferente directamente en esta carpeta (como en TUBERIA).',
          },
        },
        400,
      )
    }

    const layoutPdfEnServicio = proveedorFuentes.every((p) => p.layout === 'pdf-en-servicio')
    compararLog(
      `proveedores: ${proveedorFuentes.length}${layoutPdfEnServicio ? ' (PDF en carpeta servicio)' : ''}`,
    )

    const iaCache = await loadAnalisisIaCache(folderId)

    const resolved = await resolveCriteriosYDocumentos({
      input,
      drive,
      ia,
      iaCache,
    })
    const { criterios, documentosRequeridosTr, terminos_file_id, trCacheHit, meta, advertencias } =
      resolved
    const { conjunto, servicio, anio } = meta

    const flywheel = await loadFlywheelContext({ servicio, folder_id: folderId })
    const flywheelAppendix = formatFlywheelPromptAppendix(flywheel)
    const clar = await ia.evaluarConfianzaYClarificacion({
      servicio,
      fuente_terminos: input.fuente_terminos,
      criterios,
      terminos_texto: input.terminos_texto,
      clarificaciones: input.clarificaciones,
      flywheelAppendix,
    })

    if (input.clarificaciones?.length) {
      void saveFlywheelEntry({
        folder_id: folderId,
        servicio,
        conjunto,
        tipo: 'clarificacion',
        payload: {
          resumen: input.clarificaciones.map((x) => `${x.pregunta ?? x.id}: ${x.respuesta}`).join(' | '),
          items: input.clarificaciones,
          confianza_pct: clar.confianza_pct,
        },
        created_by: userEmail,
      })
    }

    const necesitaClarificacion =
      clar.confianza_pct < CONFIANZA_UMBRAL && clar.preguntas.length > 0

    if (necesitaClarificacion) {
      return c.json(
        {
          data: null,
          error: {
            code: 'NEEDS_CLARIFICATION',
            message:
              'Necesito aclarar algunos puntos antes de comparar (confianza < 90%). Responde las preguntas y vuelve a comparar.',
          },
          confianza_pct: clar.confianza_pct,
          preguntas: clar.preguntas,
          criterios_preview: criterios,
        },
        422,
      )
    }

    compararLog(
      `${criterios.length} criterios · ${documentosRequeridosTr.length} docs TR · confianza ${clar.confianza_pct}%`,
    )

    let contextoAprendizaje = flywheelAppendix
    if (input.clarificaciones?.length) {
      contextoAprendizaje += `\n\nAclaraciones del usuario antes de comparar:\n${input.clarificaciones
        .map((x) => `• ${x.pregunta ?? x.id}: ${x.respuesta}`)
        .join('\n')}`
    }

    const propuestasRaw: Awaited<ReturnType<typeof ia.extractPropuestaFromPdfs>>[] = []
    const archivosPorProveedor: { proveedor: string; archivos: { id: string; name: string }[] }[] = []
    const proveedoresExtraccionesCacheOut: ProveedorExtraccionCache[] = []
    const reutilProveedor: Record<string, 'cache' | 'ia'> = {}

    for (let i = 0; i < proveedorFuentes.length; i++) {
      const prov = proveedorFuentes[i]!
      compararLog(`proveedor ${i + 1}/${proveedorFuentes.length}: ${prov.name}`)

      let archivosDetalle: { id: string; name: string }[]
      let pdfs: { id: string; name: string }[]

      if (prov.layout === 'folder') {
        const files = await drive.listChildren(prov.id)
        archivosDetalle = files
          .filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && f.id && f.name)
          .map((f) => ({ id: f.id!, name: f.name! }))
          .sort((a, b) => a.name.localeCompare(b.name))
        pdfs = files.filter((f) => f.mimeType === 'application/pdf' && f.id && f.name) as {
          id: string
          name: string
        }[]
      } else {
        archivosDetalle = [{ id: prov.id, name: prov.pdfFileName }]
        pdfs = [{ id: prov.id, name: prov.pdfFileName }]
      }

      archivosPorProveedor.push({ proveedor: prov.name, archivos: archivosDetalle })
      const pdfIds = pdfs.map((p) => p.id).sort()
      const pdfFp = pdfIds.length === 0 ? '0-pdf' : fingerprintPdfIds(pdfIds)

      const cachedEx =
        trCacheHit && iaCache
          ? iaCache.proveedores_extracciones.find(
              (x) => x.folder_id === prov.id && x.pdf_fingerprint === pdfFp,
            )
          : undefined

      if (cachedEx) {
        const ex = { ...cachedEx.extraccion, proveedor: prov.name }
        propuestasRaw.push(ex)
        proveedoresExtraccionesCacheOut.push({
          folder_id: prov.id,
          proveedor_name: prov.name,
          pdf_fingerprint: pdfFp,
          extraccion: ex,
        })
        reutilProveedor[prov.name] = 'cache'
        compararLog(`  caché extracción: hit (${pdfIds.length} PDF)`)
        continue
      }

      if (pdfs.length === 0) {
        const empty = { proveedor: prov.name, nit: null, valores: [] }
        propuestasRaw.push(empty)
        proveedoresExtraccionesCacheOut.push({
          folder_id: prov.id,
          proveedor_name: prov.name,
          pdf_fingerprint: pdfFp,
          extraccion: empty,
        })
        reutilProveedor[prov.name] = 'ia'
        continue
      }

      compararLog(`  ${pdfs.length} PDF(s), descargando…`)
      const pdfBuffers = await Promise.all(
        pdfs.map(async (pdf) => {
          const { buffer, name } = await drive.downloadFileBuffer(pdf.id)
          return { name, buffer }
        }),
      )
      const extracted = await ia.extractPropuestaFromPdfs({
        proveedorNombre: prov.name,
        criterios,
        pdfBuffers,
        contextoAprendizaje,
      })
      propuestasRaw.push(extracted)
      proveedoresExtraccionesCacheOut.push({
        folder_id: prov.id,
        proveedor_name: prov.name,
        pdf_fingerprint: pdfFp,
        extraccion: extracted,
      })
      reutilProveedor[prov.name] = 'ia'
    }

    const docReqFp = fingerprintDocumentosRequeridos(documentosRequeridosTr)
    const docDriveFp = fingerprintDrivePorServicio(proveedorFolders, archivosPorProveedor)

    const docCacheHit = Boolean(
      trCacheHit &&
        iaCache &&
        iaCache.doc_req_fp === docReqFp &&
        iaCache.doc_drive_fp === docDriveFp &&
        Array.isArray(iaCache.doc_asignaciones) &&
        iaCache.doc_asignaciones.length > 0 &&
        documentosRequeridosTr.length > 0,
    )

    let asignacionesDoc: Awaited<ReturnType<typeof ia.clasificarDocumentacionProveedores>>
    if (documentosRequeridosTr.length === 0) {
      asignacionesDoc = []
      compararLog('documentación TR: sin requisitos documentales — sin clasificación')
    } else if (docCacheHit && iaCache?.doc_asignaciones) {
      asignacionesDoc = enrichAsignacionesWithFileIds(iaCache.doc_asignaciones, archivosPorProveedor)
      compararLog('caché IA · clasificación documentación: hit')
    } else {
      compararLog('cuadro documentación proveedores vs TR…')
      asignacionesDoc = await ia.clasificarDocumentacionProveedores({
        requisitos: documentosRequeridosTr,
        porProveedor: archivosPorProveedor,
      })
    }
    const documentacion = {
      requisitos: documentosRequeridosTr,
      archivos_por_proveedor: archivosPorProveedor,
      asignaciones: asignacionesDoc,
    }
    compararLog(
      `${asignacionesDoc.filter((x) => x.archivo).length}/${asignacionesDoc.length || 1} cruces archivo–requisito`,
    )

    compararLog('puntuando y ranking (Claude)…')
    const ranked = await ia.scoreAndRankTop3({ criterios, propuestas: propuestasRaw })

    compararLog('análisis extendido por criterio + financiero (Claude)…')
    const analisisExtendido = await ia.buildAnalisisExtendido({ criterios, propuestas: propuestasRaw })

    const propuestasDb = ranked.todas_las_propuestas.map((p) => {
      const ext =
        propuestasRaw.find((x) => x.proveedor === p.proveedor) ??
        propuestasRaw.find((x) => x.proveedor.toLowerCase() === p.proveedor.toLowerCase()) ??
        null
      return {
        proveedor: p.proveedor,
        puntaje: p.puntaje,
        valores: p.valores ?? {},
        justificacion: p.justificacion,
        extraccion: ext,
      }
    })

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('analisis')
      .insert({
        folder_id: folderId,
        conjunto,
        servicio,
        anio,
        criterios,
        propuestas: propuestasDb,
        top_3: ranked.top_3,
        documentacion,
        analisis_extendido: analisisExtendido,
        terminos_file_id: terminos_file_id ?? undefined,
        created_by: userEmail,
      })
      .select('id')
      .single()

    if (insErr || !inserted) {
      return c.json({ data: null, error: { code: 'DB_ERROR', message: insErr?.message ?? 'Insert falló' } }, 500)
    }

    compararLog(`listo en ${((Date.now() - t0) / 1000).toFixed(1)}s → analisis_id=${inserted.id}`)

    void saveAnalisisIaCache({
      folder_id: folderId,
      terminos_file_id: terminos_file_id,
      criterios,
      documentos_requeridos: documentosRequeridosTr,
      proveedores_extracciones: proveedoresExtraccionesCacheOut,
      doc_asignaciones: documentosRequeridosTr.length > 0 ? asignacionesDoc : null,
      doc_req_fp: documentosRequeridosTr.length > 0 ? docReqFp : null,
      doc_drive_fp: documentosRequeridosTr.length > 0 ? docDriveFp : null,
    })

    const reutilizadoIa = {
      terminos_tr: trCacheHit,
      documentacion: docCacheHit,
      proveedores: reutilProveedor,
    }

    return c.json({
      analisis_id: inserted.id,
      conjunto,
      servicio,
      criterios,
      documentacion,
      analisis_extendido: analisisExtendido,
      propuestas: propuestasDb,
      top_3: ranked.top_3,
      todas_las_propuestas: ranked.todas_las_propuestas,
      reutilizado_ia: reutilizadoIa,
      confianza_pct: clar.confianza_pct,
      fuente_terminos: input.fuente_terminos,
      advertencias: [...advertencias, ...clar.advertencias],
    })
  } catch (e: unknown) {
    const msg = ia.formatAnthropicError(e)
    console.error('[convocatorias-drive] comparar', e)
    return c.json({ data: null, error: { code: 'COMPARAR_ERROR', message: msg } }, 502)
  }
})

export default router
