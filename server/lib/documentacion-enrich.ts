/** Utilidad ligera (sin cargar módulos de IA) para enriquecer asignaciones con file_id de Drive. */

export type ArchivoEnCarpetaProveedor = { id: string; name: string }

export type DocumentacionAsignacion = {
  requisito_id: string
  proveedor: string
  archivo: string | null
  file_id?: string | null
  confianza?: 'alta' | 'media' | 'baja'
  nota?: string
}

export function enrichAsignacionesWithFileIds(
  asignaciones: DocumentacionAsignacion[],
  porProveedor: { proveedor: string; archivos: ArchivoEnCarpetaProveedor[] }[],
): DocumentacionAsignacion[] {
  const byProv = new Map(porProveedor.map((p) => [p.proveedor, p.archivos]))
  return asignaciones.map((a) => {
    if (!a.archivo) return { ...a, file_id: null }
    const list = byProv.get(a.proveedor) ?? []
    const hit = list.find((f) => f.name === a.archivo)
    return { ...a, file_id: hit?.id ?? null }
  })
}
