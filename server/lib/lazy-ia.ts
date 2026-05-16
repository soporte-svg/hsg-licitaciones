/** Carga diferida de IA: evita cold start de 30–60 s en rutas ligeras (browse, health) en Vercel. */
type IaModule = typeof import('./convocatorias-drive-ia.js')

let iaModule: IaModule | null = null

export async function getConvocatoriasIa(): Promise<IaModule> {
  if (!iaModule) iaModule = await import('./convocatorias-drive-ia.js')
  return iaModule
}
