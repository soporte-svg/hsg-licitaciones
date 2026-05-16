/** Tipos de caché IA sin importar convocatorias-drive-ia (evita arrastrar mammoth/LLM al bundle). */

export type CriterioRow = {
  id: string
  nombre: string
  peso: number | null
  tipo: string
  descripcion: string
}

export type RequisitoDocumentoTr = {
  id: string
  nombre: string
  descripcion: string
}

export type DocumentacionAsignacion = {
  requisito_id: string
  proveedor: string
  archivo: string | null
  file_id?: string | null
  confianza?: 'alta' | 'media' | 'baja'
  nota?: string
}

export type PropuestaExtract = {
  proveedor: string
  nit: string | null
  valores: {
    criterio: string
    valor_ofertado: string
    valor_numerico: number | null
    confianza: 'alta' | 'media' | 'baja'
  }[]
}
