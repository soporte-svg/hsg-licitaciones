import { createHash } from 'node:crypto'
import { supabaseAdmin } from './supabase.js'
import type { CriterioRow, DocumentacionAsignacion, PropuestaExtract, RequisitoDocumentoTr } from './analisis-ia-types.js'

export type ProveedorExtraccionCache = {
  folder_id: string
  proveedor_name: string
  pdf_fingerprint: string
  extraccion: PropuestaExtract
}

export type AnalisisIaCacheRow = {
  folder_id: string
  terminos_file_id: string | null
  criterios: CriterioRow[]
  documentos_requeridos: RequisitoDocumentoTr[]
  proveedores_extracciones: ProveedorExtraccionCache[]
  doc_asignaciones: DocumentacionAsignacion[] | null
  doc_req_fp: string | null
  doc_drive_fp: string | null
}

function sha(s: string) {
  return createHash('sha256').update(s).digest('hex')
}

/** Sube la versión al cambiar prompts de extracción/clasificación (invalida caché sin tocar Drive). */
const IA_LOGIC_VERSION = '2025-05-tr-homogeneo-resumen'

/** Huella de los PDF por carpeta de proveedor (ids ordenados). */
export function fingerprintPdfIds(pdfIds: string[]): string {
  return sha(`${IA_LOGIC_VERSION}|${[...new Set(pdfIds)].sort().join(',')}`)
}

/** Huella de la lista de requisitos documentales del TR (ids estables). */
export function fingerprintDocumentosRequeridos(docs: RequisitoDocumentoTr[]): string {
  if (docs.length === 0) return 'no-docs-req'
  return sha(docs.map((d) => d.id).sort().join(','))
}

/**
 * Huella del árbol de archivos bajo la carpeta de servicio (subcarpetas proveedor + ids de archivos).
 * Si cambia cualquier archivo o carpeta, se invalida la caché de clasificación documental.
 */
export function fingerprintDrivePorServicio(
  proveedorFolders: { id: string; name: string }[],
  archivosPorProveedor: { proveedor: string; archivos: { id: string; name: string }[] }[],
): string {
  const sortedFolders = [...proveedorFolders].sort((a, b) => a.id.localeCompare(b.id))
  const parts = sortedFolders.map((folder) => {
    const ap = archivosPorProveedor.find((x) => x.proveedor === folder.name)
    const ids = (ap?.archivos ?? [])
      .map((a) => a.id)
      .filter(Boolean)
      .sort()
      .join(',')
    return `${folder.id}:${ids}`
  })
  return sha(`${IA_LOGIC_VERSION}|${parts.join('|')}`)
}

export async function loadAnalisisIaCache(folderId: string): Promise<AnalisisIaCacheRow | null> {
  const { data, error } = await supabaseAdmin.from('analisis_ia_cache').select('*').eq('folder_id', folderId).maybeSingle()
  if (error || !data) return null
  const row = data as Record<string, unknown>
  return {
    folder_id: String(row.folder_id ?? ''),
    terminos_file_id: String(row.terminos_file_id ?? ''),
    criterios: (Array.isArray(row.criterios) ? row.criterios : []) as CriterioRow[],
    documentos_requeridos: (Array.isArray(row.documentos_requeridos)
      ? row.documentos_requeridos
      : []) as RequisitoDocumentoTr[],
    proveedores_extracciones: (Array.isArray(row.proveedores_extracciones)
      ? row.proveedores_extracciones
      : []) as ProveedorExtraccionCache[],
    doc_asignaciones: Array.isArray(row.doc_asignaciones) ? (row.doc_asignaciones as DocumentacionAsignacion[]) : null,
    doc_req_fp: row.doc_req_fp != null ? String(row.doc_req_fp) : null,
    doc_drive_fp: row.doc_drive_fp != null ? String(row.doc_drive_fp) : null,
  }
}

export async function saveAnalisisIaCache(payload: {
  folder_id: string
  terminos_file_id: string | null
  criterios: CriterioRow[]
  documentos_requeridos: RequisitoDocumentoTr[]
  proveedores_extracciones: ProveedorExtraccionCache[]
  doc_asignaciones: DocumentacionAsignacion[] | null
  doc_req_fp: string | null
  doc_drive_fp: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin.from('analisis_ia_cache').upsert(
    {
      folder_id: payload.folder_id,
      terminos_file_id: payload.terminos_file_id,
      criterios: payload.criterios,
      documentos_requeridos: payload.documentos_requeridos,
      proveedores_extracciones: payload.proveedores_extracciones,
      doc_asignaciones: payload.doc_asignaciones,
      doc_req_fp: payload.doc_req_fp,
      doc_drive_fp: payload.doc_drive_fp,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'folder_id' },
  )
  if (error) {
    console.warn('[analisis_ia_cache] upsert:', error.message)
  }
}
