const DEFAULT_TERMINOS_FOLDER_ID = '1EBHgOv2o9O1WR8yOBu5NFRrd16nCOP2V'

export function getDriveRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim()
  if (!id) {
    throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID no está configurada.')
  }
  return id
}

export function getTerminosFolderId(): string {
  return process.env.GOOGLE_DRIVE_TERMINOS_FOLDER_ID?.trim() || DEFAULT_TERMINOS_FOLDER_ID
}
