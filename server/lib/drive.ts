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
      throw new Error(
        `Archivo de credenciales no encontrado: ${pathLike}. En Vercel usa la variable GOOGLE_SERVICE_ACCOUNT_KEY con el JSON completo del service account.`,
      )
    }
    jsonStr = readFileSync(pathLike, 'utf8')
  } else {
    throw new Error(
      'Configura GOOGLE_SERVICE_ACCOUNT_KEY o DRIVE_CREDENTIALS_JSON (ruta al .json del service account).',
    )
  }

  let parsed: { client_email?: string; private_key?: string }
  try {
    parsed = JSON.parse(jsonStr) as { client_email?: string; private_key?: string }
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY no es JSON válido. En Vercel pega el archivo .json completo en una sola variable (sin ruta a secrets/).',
    )
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Credenciales Google: faltan client_email o private_key en el JSON.')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

import { getDriveRootFolderId, getTerminosFolderId } from './drive-config.js'

export { getDriveRootFolderId, getTerminosFolderId }

let driveClientPromise: ReturnType<typeof google.drive> | null = null

const DRIVE_AUTH_TIMEOUT_MS = Number(process.env.DRIVE_AUTH_TIMEOUT_MS) || 20_000

export async function getDriveClient() {
  if (!driveClientPromise) {
    driveClientPromise = (async () => {
      const creds = parseServiceAccount()
      const auth = new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: [DRIVE_READONLY],
      })
      await withTimeout(auth.authorize(), DRIVE_AUTH_TIMEOUT_MS, 'Google auth')
      return google.drive({ version: 'v3', auth })
    })()
  }
  return driveClientPromise
}

const DRIVE_LIST_TIMEOUT_MS = Number(process.env.DRIVE_LIST_TIMEOUT_MS) || 25_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}: tiempo de espera agotado (${ms / 1000}s).`)), ms)
    }),
  ])
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
  if (mimeType === DOCX_MIME || mimeType === 'application/msword') return true
  if (mimeType === GOOGLE_DOC_MIME) return true
  if (name && /\.docx?$/i.test(name)) return true
  if (mimeType === 'application/pdf' || (name && /\.pdf$/i.test(name))) return true
  return false
}

/** PDF/DOCX en carpeta central que parezca un TR (no cualquier PDF suelto). */
export function looksLikeTerminosFileName(name: string): boolean {
  const n = normalizeFileName(name)
  if (n.includes('termino') || n.includes('referencia')) return true
  if (/\btr\b/.test(n) && (n.includes('hsg') || n.includes('(') || /\s-\s/.test(n))) return true
  if (/^tr\s/.test(n) || n.startsWith('tr hsg')) return true
  return false
}

export async function listChildren(parentId: string) {
  const drive = await getDriveClient()
  const all: NonNullable<Awaited<ReturnType<typeof drive.files.list>>['data']['files']> = []
  let pageToken: string | undefined
  do {
    const res = await withTimeout(
      drive.files.list({
        q: `'${parentId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id,name,mimeType)',
        pageSize: 200,
        pageToken,
        orderBy: 'name_natural',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
      DRIVE_LIST_TIMEOUT_MS,
      'Google Drive list',
    )
    if (res.data.files?.length) all.push(...res.data.files)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return all
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

/** Ej. "TR HSG (Aseo).docx" o "TR HSG - Tuberia-galvanizada.pdf" → claves de servicio. */
function terminosFileKeys(fileName: string): string[] {
  const norm = stripDocExtension(fileName)
  const keys = new Set<string>()
  if (norm) keys.add(serviceKey(norm))

  for (const m of norm.matchAll(/\(([^)]+)\)/g)) {
    const inner = serviceKey(m[1] ?? '')
    if (inner.length > 1) keys.add(inner)
  }

  const dashMatch = norm.match(/\s+-\s+(.+)$/)
  if (dashMatch?.[1]) {
    const afterDash = serviceKey(dashMatch[1])
    if (afterDash.length > 1) {
      keys.add(afterDash)
      const firstWord = afterDash.split(' ').find((w) => w.length > 2)
      if (firstWord) keys.add(firstWord)
    }
  }

  return [...keys]
}

export function scoreTerminosMatch(fileName: string, serviceLabel: string): number {
  const target = serviceKey(serviceLabel)
  if (!target || target.length < 2) return 0

  let best = 0
  const fileKeys = terminosFileKeys(fileName)
  const fullFile = serviceKey(fileName)

  for (const fk of fileKeys) {
    if (fk === target) best = Math.max(best, 100)
    else if (fk.includes(target) || target.includes(fk)) best = Math.max(best, 92)
  }

  if (fullFile.includes(target)) best = Math.max(best, 85)

  const targetWords = target.split(' ').filter((w) => w.length > 2)
  const fileWords = fullFile.split(' ')
  if (targetWords.length > 0 && targetWords.every((w) => fileWords.some((fw) => fw === w || fw.includes(w)))) {
    best = Math.max(best, 78)
  }

  if (target.length >= 4) {
    for (const fw of fileWords) {
      if (fw.length >= 4 && (fw.startsWith(target) || target.startsWith(fw))) {
        best = Math.max(best, 70)
      }
    }
  }

  return best
}

function isTerminosCandidate(
  f: { mimeType?: string | null; name?: string | null },
): boolean {
  if (!f.name || !isTerminosMime(f.mimeType, f.name)) return false
  const isPdf = f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name)
  if (isPdf) return looksLikeTerminosFileName(f.name)
  return looksLikeTerminosFileName(f.name) || isTerminosFileName(f.name) || /^tr\s/i.test(f.name)
}

const ANCESTOR_LABEL_SKIP = new Set(
  ['drive', 'convocatorias', 'propuestas', 'licitaciones', 'servicios'].map((s) => s),
)

function matchLabelsForTerminos(serviceName: string, ancestorNames: string[]): string[] {
  const labels = [serviceName]
  for (const a of ancestorNames) {
    const k = serviceKey(a)
    if (k.length < 4 || ANCESTOR_LABEL_SKIP.has(k)) continue
    if (/^convocatorias\s/.test(k)) continue
    if (/^20[0-9]{2}$/.test(k)) continue
    labels.push(a)
  }
  return [...new Set(labels)]
}

/** Busca el documento de términos en la carpeta central (`GOOGLE_DRIVE_TERMINOS_FOLDER_ID`). */
export async function findTerminosFileForServiceFolder(
  serviceFolderId: string,
): Promise<{ id: string; name: string; mimeType: string } | null> {
  const meta = await getFileMeta(serviceFolderId)
  const serviceName = meta.name?.trim()
  if (!serviceName) return null

  const ancestorNames = await walkAncestorsFromFolder(serviceFolderId)
  const matchLabels = matchLabelsForTerminos(serviceName, ancestorNames)

  const candidates = (await listChildren(getTerminosFolderId())).filter(
    (f) => f.id && f.name && isTerminosCandidate(f),
  )

  const rank = (labels: string[]) => {
    let best: { id: string; name: string; mimeType: string; score: number } | null = null
    for (const f of candidates) {
      let score = 0
      for (const label of labels) {
        score = Math.max(score, scoreTerminosMatch(f.name!, label))
      }
      if (score === 0) continue
      if (isTerminosFileName(f.name!)) score += 3
      if (/^tr\s/i.test(f.name!) || normalizeFileName(f.name!).includes('tr hsg')) score += 2
      const mimeType = f.mimeType ?? 'application/octet-stream'
      if (!best || score > best.score) {
        best = { id: f.id!, name: f.name!, mimeType, score }
      }
    }
    return best
  }

  let best = rank([serviceName])
  if (!best || best.score < 70) {
    const fallback = rank(matchLabels)
    if (fallback && (!best || fallback.score > best.score)) best = fallback
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
