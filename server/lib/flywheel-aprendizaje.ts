import { supabaseAdmin } from './supabase.js'

export type FlywheelTipo =
  | 'clarificacion'
  | 'correccion_criterio'
  | 'correccion_extraccion'
  | 'nota_endir'
  | 'calificacion_analisis'

export type FlywheelEntry = {
  id: string
  tipo: FlywheelTipo
  payload: Record<string, unknown>
  calificacion_endir: number | null
  created_at: string
}

export async function saveFlywheelEntry(args: {
  folder_id?: string | null
  servicio?: string | null
  conjunto?: string | null
  tipo: FlywheelTipo
  payload: Record<string, unknown>
  calificacion_endir?: number | null
  created_by: string
}): Promise<void> {
  const { error } = await supabaseAdmin.from('flywheel_aprendizaje').insert({
    folder_id: args.folder_id ?? null,
    servicio: args.servicio ?? null,
    conjunto: args.conjunto ?? null,
    tipo: args.tipo,
    payload: args.payload,
    calificacion_endir: args.calificacion_endir ?? null,
    created_by: args.created_by,
  })
  if (error) {
    console.warn('[flywheel] no se pudo guardar:', error.message)
  }
}

export async function loadFlywheelContext(args: {
  servicio?: string | null
  folder_id?: string | null
  limit?: number
}): Promise<FlywheelEntry[]> {
  const limit = args.limit ?? 12
  let q = supabaseAdmin
    .from('flywheel_aprendizaje')
    .select('id, tipo, payload, calificacion_endir, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (args.servicio?.trim()) {
    q = q.eq('servicio', args.servicio.trim())
  } else if (args.folder_id?.trim()) {
    q = q.eq('folder_id', args.folder_id.trim())
  } else {
    return []
  }

  const { data, error } = await q
  if (error || !data) {
    console.warn('[flywheel] lectura:', error?.message ?? 'sin datos')
    return []
  }
  return data as FlywheelEntry[]
}

export function formatFlywheelPromptAppendix(entries: FlywheelEntry[]): string {
  if (!entries.length) return ''
  const lines = entries.map((e) => {
    const cal =
      e.calificacion_endir != null ? ` [Endir: ${e.calificacion_endir}/5]` : ''
    const body =
      typeof e.payload.resumen === 'string'
        ? e.payload.resumen
        : JSON.stringify(e.payload).slice(0, 600)
    return `- (${e.tipo}${cal}) ${body}`
  })
  return `\n\n--- APRENDIZAJE PREVIO (equipo HSG / Endir) ---\nAplica estas correcciones y no repitas los mismos errores:\n${lines.join('\n')}`
}
