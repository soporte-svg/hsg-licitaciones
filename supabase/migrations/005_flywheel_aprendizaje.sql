-- Flywheel de mejora continua (feedback Endir / equipo HSG) para refinar prompts en comparaciones futuras.

CREATE TABLE IF NOT EXISTS public.flywheel_aprendizaje (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id         TEXT,
  servicio          TEXT,
  conjunto          TEXT,
  tipo              TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  calificacion_endir SMALLINT CHECK (calificacion_endir IS NULL OR (calificacion_endir >= 1 AND calificacion_endir <= 5)),
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.flywheel_aprendizaje IS 'Correcciones y clarificaciones persistentes para el ciclo de aprendizaje de la IA (Endir).';

CREATE INDEX IF NOT EXISTS flywheel_servicio_created_at_idx
  ON public.flywheel_aprendizaje (servicio, created_at DESC);

CREATE INDEX IF NOT EXISTS flywheel_folder_id_created_at_idx
  ON public.flywheel_aprendizaje (folder_id, created_at DESC);

ALTER TABLE public.flywheel_aprendizaje ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flywheel_select_own_email ON public.flywheel_aprendizaje;
CREATE POLICY flywheel_select_own_email
  ON public.flywheel_aprendizaje
  FOR SELECT
  TO authenticated
  USING (created_by = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS flywheel_insert_own_email ON public.flywheel_aprendizaje;
CREATE POLICY flywheel_insert_own_email
  ON public.flywheel_aprendizaje
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = (auth.jwt() ->> 'email'));
