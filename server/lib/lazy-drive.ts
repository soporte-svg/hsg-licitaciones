/** Carga diferida de googleapis: solo en rutas que usan Drive (browse, comparar, pdf). */
type DriveModule = typeof import('./drive.js')

let driveModule: DriveModule | null = null

export async function getDrive(): Promise<DriveModule> {
  if (!driveModule) driveModule = await import('./drive.js')
  return driveModule
}
