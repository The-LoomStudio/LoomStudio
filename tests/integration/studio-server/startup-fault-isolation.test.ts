import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '@loom-studio/kernel/platform'
import { createMemorySecretBackend } from '@loom-studio/kernel/secret-store'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { callRpc } from './helpers.js'

it('starts and serves healthy resources while retaining a corrupt Card deletion journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-startup-isolation-'))
  const localPaths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
  const metadata = join(localPaths.dataRoot, '.loom/card-directories/broken-card')
  await mkdir(metadata, { recursive: true })
  await writeFile(join(metadata, 'delete.json'), '{broken')
  const logs = createMemoryLogSink({ capacity: 100 })
  const server = createStudioServer({ localPaths, secretBackend: createMemorySecretBackend(),
    extensionRootDirectory: join(root, 'repository'), extensionInstalledDirectory: join(root, 'installed'),
    logger: createRootLogger({ service: 'test', instanceId: 'startup', sinks: [logs] }).child('server'),
  })
  try {
    const { port } = await server.listen(0)
    await expect(callRpc(port, 'application.listCards', {})).resolves.toBeDefined()
    expect(await readFile(join(metadata, 'delete.json'), 'utf8')).toBe('{broken')
    expect(logs.list().some(item => item.event === 'card.directory.recovery_failed')).toBe(true)
  } finally { await server.close(); await rm(root, { recursive: true, force: true }) }
})
