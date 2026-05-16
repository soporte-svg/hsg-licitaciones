-- Análisis por criterio (bullets, cobertura) + bloque financiero comparativo.
ALTER TABLE public.analisis
  ADD COLUMN IF NOT EXISTS analisis_extendido JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.analisis.analisis_extendido IS 'analisis_criterios + financiero (IA post-comparación).';
