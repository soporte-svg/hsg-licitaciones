-- Caché de salidas de IA por carpeta de servicio (folder_id) para no repetir extracciones costosas.
CREATE TABLE IF NOT EXISTS public.analisis_ia_cache (
  folder_id TEXT PRIMARY KEY,
  terminos_file_id TEXT NOT NULL,
  criterios JSONB NOT NULL DEFAULT '[]'::jsonb,
  documentos_requeridos JSONB NOT NULL DEFAULT '[]'::jsonb,
  proveedores_extracciones JSONB NOT NULL DEFAULT '[]'::jsonb,
  doc_asignaciones JSONB,
  doc_req_fp TEXT,
  doc_drive_fp TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.analisis_ia_cache IS 'Reutiliza criterios, documentos TR, extracciones por carpeta proveedor y asignaciones documentales cuando no cambian los archivos en Drive.';

CREATE INDEX IF NOT EXISTS analisis_ia_cache_updated_at_idx ON public.analisis_ia_cache (updated_at DESC);
