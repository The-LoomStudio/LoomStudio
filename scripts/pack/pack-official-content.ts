import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { readOfficialContent } from '../../apps/studio-server/src/official/official-content.js'

const [source, output] = process.argv.slice(2)
if (!source) throw new Error('Specify an explicit legacy catalog directory; official content is distributed as extensions')
const content = await readOfficialContent(resolve(source))
const filename = resolve(output ?? `.artifacts/${content.catalog.id}-${content.catalog.version}.zip`)
await mkdir(dirname(filename), { recursive: true })
const archive = zipSync(content.files)
await writeFile(filename, archive)
console.log(JSON.stringify({
  file: filename,
  packageId: content.catalog.id,
  version: content.catalog.version,
  contentDigest: content.digest,
  bytes: archive.byteLength,
}, null, 2))
