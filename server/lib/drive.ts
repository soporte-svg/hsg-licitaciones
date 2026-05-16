import { existsSync, readFileSync } from 'node:fs'
import { google } from 'googleapis'

const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'

function parseServiceAccount(): { client_email: string; private_key: string } {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim()
  const pathLike =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim() ||
    process.env.DRIVE_CREDENTIALS_JSON?.trim()

  let jsonStr: string
  if (inline) {
    jsonStr = inline
  } else if (pathLike) {
    if (!existsSync(pathLike)) {
      throw new Error(`Archivo de credenciales no encontrado: ${pathLike}`)
    }
    jsonStr = readFileSync(pathLike, 'utf8')
  } else {
    throw new Error(
      'Configura GOOGLE_SERVICE_ACCOUNT_KEY o DRIVE_CREDENTIALS_JSON (ruta al .json del service account).',
    )
  }

  const parsed = JSON.parse(jsonStr) as { client_email?: string; private_key?: string }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Credenciales Google: faltan client_email o private_key en el JSON.')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

const DEFAULT_TERMINOS_FOLDER_ID = '1EBHgOv2o9O1WR8yOBu5NFRrd16nCOP2V'

export function getDriveRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim()
  if (!id) {
    throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID no está configurada.')
  }
  return id
}

/** Carpeta compartida donde viven todos los documentos de términos de referencia. */
export function getTerminosFolderId(): string {
  return process.env.GOOGLE_DRIVE_TERMINOS_FOLDER_ID?.trim() || DEFAULT_TERMINOS_FOLDER_ID
}

export async function getDriveClient() {
  const creds = parseServiceAccount()
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [DRIVE_READONLY],
  })
  await auth.authorize()
  return google.drive({ version: 'v3', auth })
}

export function normalizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export function isTerminosFileName(name: string): boolean {
  return normalizeFileName(name).includes('terminos')
}

export function isTerminosMime(mimeType?: string | null, name?: string | null): boolean {
  if (mimeType === 'application/pdf') return true
  if (mimeType === DOCX_MIME || mimeType === 'application/msword') return true
  if (mimeType === GOOGLE_DOC_MIME) return true
  if (name && /\.docx?$/i.test(name)) return true
  return false
}

export async function listChildren(parentId: string) {
  const drive = await getDriveClient()
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
    pageSize: 1000,
    orderBy: 'name_natural',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  return res.data.files ?? []
}

export async function getFileMeta(fileId: string) {
  const drive = await getDriveClient()
  const res = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,parents',
    supportsAllDrives: true,
  })
  return res.data
}

function stripDocExtension(name: string): string {
  return normalizeFileName(name).replace(/\.(pdf|docx?|doc)$/i, '').trim()
}

/** Clave comparable: sin tildes, sin signos, espacios colapsados. */
function serviceKey(name: string): string {
  return stripDocExtension(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ej. "TR HSG (Aseo) - .docx" → ["aseo", "tr hsg aseo", ...] */
function terminosFileKeys(fileName: string): string[] {
  const norm = stripDocExtension(fileName)
  const keys = new Set<string>()
  if (norm) keys.add(serviceKey(norm))

  for (const m of norm.matchAll(/\(([^)]+)\)/g)) {
    const inner = serviceKey(m[1] ?? '')
    if (inner.length > 1) keys.add(inner)
  }

  return [...keys]
}

function scoreTerminosMatch(fileName: string, serviceLabel: string): number {
  const target = serviceKey(serviceLabel)
  if (!target) return 0

  let best = 0
  const fileKeys = terminosFileKeys(fileName)
  const fullFile = serviceKey(fileName)

  for (const fk of fileKeys) {
    if (fk === target) best = Math.max(best, 100)
    else if (fk.includes(target) || target.includes(fk)) best = Math.max(best, 90)
  }

  if (fullFile.includes(target)) best = Math.max(best, 80)

  const targetWords = target.split(' ').filter((w) => w.length > 2)
  const fileWords = fullFile.split(' ')
  if (targetWords.length > 0 && targetWords.every((w) => fileWords.some((fw) => fw === w || fw.includes(w)))) {
    best = Math.max(best, 75)
  }

  return best
}

function isTerminosCandidate(
  f: { mimeType?: string | null; name?: string | null },
): boolean {
  if (!f.name) return false
  return isTerminosMime(f.mimeType, f.name)
}

/** Busca el documento de términos en la carpeta central (`GOOGLE_DRIVE_TERMINOS_FOLDER_ID`). */
export async function findTerminosFileForServiceFolder(
  serviceFolderId: string,
): Promise<{ id: string; name: string; mimeType: string } | null> {
  const meta = await getFileMeta(serviceFolderId)
  const serviceName = meta.name?.trim()
  if (!serviceName) return null

  const ancestorNames = await walkAncestorsFromFolder(serviceFolderId)
  const matchLabels = [...new Set([serviceName, ...ancestorNames])]

  const candidates = (await listChildren(getTerminosFolderId())).filter(
    (f) => f.id && f.name && isTerminosCandidate(f),
  )

  let best: { id: string; name: string; mimeType: string; score: number } | null = null
  for (const f of candidates) {
    let score = 0
    for (const label of matchLabels) {
      score = Math.max(score, scoreTerminosMatch(f.name!, label))
    }
    if (score === 0) continue
    if (isTerminosFileName(f.name!)) score += 3
    if (/^tr\s/i.test(f.name!)) score += 2
    const mimeType = f.mimeType ?? 'application/octet-stream'
    if (!best || score > best.score) {
      best = { id: f.id!, name: f.name!, mimeType, score }
    }
  }

  return best ? { id: best.id, name: best.name, mimeType: best.mimeType } : null
}

/** @deprecated Usar findTerminosFileForServiceFolder */
export const findTerminosPdfForServiceFolder = findTerminosFileForServiceFolder

export async function downloadFileBuffer(fileId: string): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  const drive = await getDriveClient()
  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType',
    supportsAllDrives: true,
  })
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  const buffer = Buffer.from(res.data as ArrayBuffer)
  const mimeType = meta.data.mimeType ?? 'application/octet-stream'
  const name = meta.data.name ?? 'archivo'
  return { buffer, name, mimeType }
}

/** Descarga términos; exporta Google Docs a .docx si aplica. */
export async function downloadTerminosFile(
  fileId: string,
  mimeTypeHint?: string,
): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  const meta = await getFileMeta(fileId)
  const mimeType = mimeTypeHint ?? meta.mimeType ?? 'application/octet-stream'
  const name = meta.name ?? 'terminos'

  if (mimeType === GOOGLE_DOC_MIME) {
    const drive = await getDriveClient()
    const res = await drive.files.export(
      { fileId, mimeType: DOCX_MIME },
      { responseType: 'arraybuffer' },
    )
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      name: name.endsWith('.docx') ? name : `${name}.docx`,
      mimeType: DOCX_MIME,
    }
  }

  return downloadFileBuffer(fileId)
}

export async function walkAncestorsFromFolder(serviceFolderId: string): Promise<string[]> {
  const rootId = getDriveRootFolderId()
  const names: string[] = []
  let current: string | null | undefined = serviceFolderId

  while (current && current !== rootId) {
    const meta = await getFileMeta(current)
    if (meta.name) names.push(meta.name)
    current = meta.parents?.[0]
  }

  return names
}

export function inferConvocatoriaMeta(namesFromLeaf: string[]): {
  conjunto: string
  servicio: string
  anio: number
} {
  const servicio = namesFromLeaf[0] ?? '—'
  const conjunto = namesFromLeaf.length > 1 ? namesFromLeaf[namesFromLeaf.length - 1]! : '—'
  let anio = new Date().getFullYear()
  for (const n of namesFromLeaf) {
    const m = n.match(/(20[0-9]{2})/)
    if (m) {
      anio = Number.parseInt(m[1]!, 10)
      break
    }
  }
  return { conjunto, servicio, anio }
}
