-- Cuadro de documentación vs archivos por proveedor (cruce desde TR).
ALTER TABLE public.analisis
  ADD COLUMN IF NOT EXISTS documentacion JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.analisis.documentacion IS 'Requisitos documentales TR, archivos por carpeta y matriz proveedor × requisito.';
