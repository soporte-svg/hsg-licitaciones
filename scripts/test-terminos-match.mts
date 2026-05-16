import '../server/load-env.js'
import {
  findTerminosFileForServiceFolder,
  getDriveRootFolderId,
  listChildren,
} from '../server/lib/drive.js'

async function findAseoFolder(): Promise<string | null> {
  const root = getDriveRootFolderId()
  const stack = [root]
  while (stack.length) {
    const id = stack.pop()!
    const children = await listChildren(id)
    for (const f of children) {
      if (!f.id || !f.name) continue
      if (/aseo/i.test(f.name) && f.mimeType?.includes('folder')) return f.id
      if (f.mimeType?.includes('folder')) stack.push(f.id)
    }
  }
  return null
}

const folderId = process.argv[2] ?? (await findAseoFolder())
if (!folderId) {
  console.error('No se encontró carpeta Aseo')
  process.exit(1)
}

const found = await findTerminosFileForServiceFolder(folderId)
console.log('folder_id:', folderId)
console.log(found ? `OK: ${found.name}` : 'NO encontrado')
