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

const router = new Hono()

const compararBodySchema = z.object({
  folder_id: z.string().min(3),
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
            'No hay términos en la carpeta central para este servicio. Se buscan archivos como «TR HSG (NombreServicio).docx» según el nombre de la carpeta.',
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

router.post('/comparar', requireAuth, zValidator('json', compararBodySchema), async (c) => {
  const { folder_id: folderId } = c.req.valid('json')
  const userEmail = c.get('userEmail')
  const t0 = Date.now()
  const ia = await getConvocatoriasIa()
  const drive = await getDrive()

  try {
    compararLog(`inicio folder=${folderId}`)
    const terminos = await drive.findTerminosFileForServiceFolder(folderId)

    if (!terminos?.id) {
      return c.json(
        {
          data: null,
          error: {
            code: 'NO_TERMINOS',
            message:
              'No se encontró términos en la carpeta central para esta carpeta de servicio (p. ej. «TR HSG (Aseo).docx» para la carpeta Aseo).',
          },
        },
        400,
      )
    }

    const rawFolders = await drive.listChildren(folderId)
    const proveedorFolders = rawFolders
      .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.id && f.name)
      .map((f) => ({ id: f.id!, name: f.name! }))

    if (proveedorFolders.length === 0) {
      return c.json(
        {
          data: null,
          error: { code: 'NO_PROVEEDORES', message: 'No hay subcarpetas de proveedores en esta carpeta de servicio.' },
        },
        400,
      )
    }

    compararLog(`términos: ${terminos.name} | proveedores: ${proveedorFolders.length}`)

    const iaCache = await loadAnalisisIaCache(folderId)
    const trCacheHit = Boolean(
      iaCache &&
        iaCache.terminos_file_id === terminos.id &&
        Array.isArray(iaCache.criterios) &&
        iaCache.criterios.length > 0,
    )

    let criterios: Awaited<ReturnType<typeof ia.extractCriteriosFromTerminosDocument>>
    let documentosRequeridosTr: Awaited<ReturnType<typeof ia.extractDocumentosRequeridosFromTerminos>>

    if (trCacheHit && iaCache) {
      criterios = iaCache.criterios
      documentosRequeridosTr = iaCache.documentos_requeridos
      compararLog('caché IA · TR (criterios + documentos): hit — sin descargar términos ni llamadas IA al TR')
    } else {
      compararLog('descargando términos…')
      const { buffer: terminosBuf, name: terminosName, mimeType: terminosMime } =
        await drive.downloadTerminosFile(terminos.id, terminos.mimeType)
      compararLog('extrayendo criterios y documentación exigida (Claude en paralelo)…')
      ;[criterios, documentosRequeridosTr] = await Promise.all([
        ia.extractCriteriosFromTerminosDocument(terminosBuf, terminosName, terminosMime),
        ia.extractDocumentosRequeridosFromTerminos(terminosBuf, terminosName, terminosMime),
      ])
      compararLog('caché IA · TR: miss')
    }
    compararLog(`${criterios.length} criterios · ${documentosRequeridosTr.length} ítems documentales (TR)`)

    const propuestasRaw: Awaited<ReturnType<typeof ia.extractPropuestaFromPdfs>>[] = []
    const archivosPorProveedor: { proveedor: string; archivos: { id: string; name: string }[] }[] = []
    const proveedoresExtraccionesCacheOut: ProveedorExtraccionCache[] = []
    const reutilProveedor: Record<string, 'cache' | 'ia'> = {}

    for (let i = 0; i < proveedorFolders.length; i++) {
      const folder = proveedorFolders[i]!
      compararLog(`proveedor ${i + 1}/${proveedorFolders.length}: ${folder.name}`)
      const files = await drive.listChildren(folder.id)
      const archivosDetalle = files
        .filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && f.id && f.name)
        .map((f) => ({ id: f.id!, name: f.name! }))
        .sort((a, b) => a.name.localeCompare(b.name))
      archivosPorProveedor.push({ proveedor: folder.name, archivos: archivosDetalle })
      const pdfs = files.filter((f) => f.mimeType === 'application/pdf' && f.id && f.name)
      const pdfIds = pdfs.map((p) => p.id!).sort()
      const pdfFp = pdfIds.length === 0 ? '0-pdf' : fingerprintPdfIds(pdfIds)

      const cachedEx =
        trCacheHit && iaCache
          ? iaCache.proveedores_extracciones.find(
              (x) => x.folder_id === folder.id && x.pdf_fingerprint === pdfFp,
            )
          : undefined

      if (cachedEx) {
        const ex = { ...cachedEx.extraccion, proveedor: folder.name }
        propuestasRaw.push(ex)
        proveedoresExtraccionesCacheOut.push({
          folder_id: folder.id,
          proveedor_name: folder.name,
          pdf_fingerprint: pdfFp,
          extraccion: ex,
        })
        reutilProveedor[folder.name] = 'cache'
        compararLog(`  caché extracción: hit (${pdfIds.length} PDF)`)
        continue
      }

      if (pdfs.length === 0) {
        const empty = { proveedor: folder.name, nit: null, valores: [] }
        propuestasRaw.push(empty)
        proveedoresExtraccionesCacheOut.push({
          folder_id: folder.id,
          proveedor_name: folder.name,
          pdf_fingerprint: pdfFp,
          extraccion: empty,
        })
        reutilProveedor[folder.name] = 'ia'
        continue
      }

      compararLog(`  ${pdfs.length} PDF(s), descargando…`)
      const pdfBuffers = await Promise.all(
        pdfs.map(async (pdf) => {
          const { buffer, name } = await drive.downloadFileBuffer(pdf.id!)
          return { name, buffer }
        }),
      )
      const extracted = await ia.extractPropuestaFromPdfs({
        proveedorNombre: folder.name,
        criterios,
        pdfBuffers,
      })
      propuestasRaw.push(extracted)
      proveedoresExtraccionesCacheOut.push({
        folder_id: folder.id,
        proveedor_name: folder.name,
        pdf_fingerprint: pdfFp,
        extraccion: extracted,
      })
      reutilProveedor[folder.name] = 'ia'
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

    const names = await drive.walkAncestorsFromFolder(folderId)
    const { conjunto, servicio, anio } = drive.inferConvocatoriaMeta(names)

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
        terminos_file_id: terminos.id,
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
      terminos_file_id: terminos.id,
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
    })
  } catch (e: unknown) {
    const msg = ia.formatAnthropicError(e)
    console.error('[convocatorias-drive] comparar', e)
    return c.json({ data: null, error: { code: 'COMPARAR_ERROR', message: msg } }, 502)
  }
})

export default router
