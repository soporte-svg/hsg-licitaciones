-- Tabla de análisis comparativos (proyecto licitaciones).
-- Aplicar en tu proyecto Supabase: SQL Editor o `supabase db push` desde esta carpeta.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.analisis (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folder_id         TEXT NOT NULL,
  conjunto          TEXT NOT NULL,
  servicio          TEXT NOT NULL,
  anio              INTEGER NOT NULL,
  criterios         JSONB NOT NULL DEFAULT '[]'::jsonb,
  propuestas        JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_3             JSONB NOT NULL DEFAULT '[]'::jsonb,
  terminos_file_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT NOT NULL
);

COMMENT ON TABLE public.analisis IS 'Cuadro comparativo generado por IA por carpeta de servicio en Google Drive.';

CREATE INDEX IF NOT EXISTS analisis_folder_id_created_at_idx
  ON public.analisis (folder_id, created_at DESC);

ALTER TABLE public.analisis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analisis_select_own_email ON public.analisis;
CREATE POLICY analisis_select_own_email
  ON public.analisis
  FOR SELECT
  TO authenticated
  USING (created_by = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS analisis_insert_own_email ON public.analisis;
CREATE POLICY analisis_insert_own_email
  ON public.analisis
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = (auth.jwt() ->> 'email'));
