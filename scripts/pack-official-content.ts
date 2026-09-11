import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { readOfficialContent } from '../apps/studio-server/src/official/official-content.js'

const [source = 'official/starter', output] = process.argv.slice(2)
const content = await readOfficialContent(resolve(source))
const filename = resolve(output ?? `.artifacts/${content.catalog.id}-${content.catalog.version}.zip`)
await mkdir(dirname(filename), { recursive: true })
await writeFile(filename, zipSync(content.files), { flag: 'wx' })
console.log(JSON.stringify({ file: filename, packageId: content.catalog.id, version: content.catalog.version, contentDigest: content.digest }, null, 2))
