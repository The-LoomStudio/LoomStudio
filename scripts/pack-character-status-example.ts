import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { encodeCardBundleZip } from '../apps/studio-server/src/codecs/card-bundle-zip.js'
import { defaultCardPng } from '../apps/studio-server/src/codecs/card-png.js'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'

export async function buildCharacterStatusCardBundle(root = resolve('examples/character-status')) {
  const artifact = JSON.parse(await readFile(join(root, 'card.json'), 'utf8')) as CardBundleArtifact
  const source = await readFile(join(resolve('examples/loom-scripts'), 'alice-presentation.loom.js'), 'utf8')
  artifact.scriptAttachments = [{
    orderIndex: 120,
    script: {
      format: 'loom.script',
      schemaVersion: 1,
      fileName: 'character-status.loom.js',
      source,
    },
  }]
  return encodeCardBundleZip({
    artifact,
    avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
  })
}

const output = resolve(process.argv[2] ?? '.artifacts/character-status.loomcard.zip')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, await buildCharacterStatusCardBundle(), { flag: 'wx' })
console.log(JSON.stringify({ file: output, bytes: (await readFile(output)).byteLength }, null, 2))
