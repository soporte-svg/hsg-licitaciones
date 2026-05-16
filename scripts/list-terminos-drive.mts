import '../server/load-env.js'
import { listChildren, getTerminosFolderId } from '../server/lib/drive.js'

async function main() {
  const root = getTerminosFolderId()
  console.log('Terminos folder:', root)
  const top = await listChildren(root)
  for (const f of top) {
    console.log(f.mimeType, '|', f.name)
    if (f.mimeType === 'application/vnd.google-apps.folder' && f.id) {
      const kids = await listChildren(f.id)
      for (const k of kids) console.log('   ', k.mimeType, '|', k.name)
    }
  }
  console.log('Total at root:', top.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
