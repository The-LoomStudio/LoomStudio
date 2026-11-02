import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { withStudioServer, callRpc } from './helpers.js'

const script = resolve('scripts/dev/resource-authoring.ts')
async function cli(...args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args])
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}
describe('resource authoring CLI over authenticated HTTP', () => {
  it.each(['lore', 'preset'] as const)('exports and applies %s with stable identity, conflicts and watch', async resourceKind => {
    await withStudioServer(async (port, temporary) => {
      const endpoint = `http://127.0.0.1:${port}`
      // Author a preset without the unrelated default CodeAct Content mount.
      const created = resourceKind === 'lore'
        ? await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', { name: 'Authoring CLI', resourceKind })
        : (await callRpc<{ resources: Array<{ resource: { id: string } }> }>(port, 'application.applyResourceAuthoring', { resources: [{ create: true, resource: {
          format: 'loom.resource.authoring', schemaVersion: 1, id: 'xml-cli-preset', resourceKind,
          rootNode: { id: 'xml-cli-root', kind: 'module', label: 'Authoring CLI', children: [
            { id: 'xml-cli-message', kind: 'message', label: 'System', capabilities: { roleHint: 'system' }, children: [
              { id: 'xml-cli-entry', kind: 'entry', label: 'Instructions', body: 'Keep this body unchanged.' },
            ] },
          ] }, toolMounts: [], loreMounts: [],
        } }] })).resources[0]!

      const directory = join(temporary, 'author')
      const other = join(temporary, 'other')
      for (const path of [directory, other]) {
        const result = await cli('export', path, '--endpoint', endpoint, '--resource', created.resource.id)
        expect(result, result.stderr).toMatchObject({ code: 0 })
      }
      if (resourceKind === 'preset') {
        const compositionPath = join(directory, 'composition.xml')
        const composition = await readFile(compositionPath, 'utf8')
        expect(composition).toContain('<Preset>')
        await writeFile(compositionPath, '<Preset><Unknown /></Preset>')
        expect(await cli('check', directory)).toMatchObject({ code: 2 })
        await writeFile(compositionPath, composition)
      }
      const initial = await callRpc<{ version: number }>(port, 'application.captureResourceAuthoring', { resourceId: created.resource.id })
      const firstApply = await cli('apply', directory)
      expect(firstApply, firstApply.stderr).toMatchObject({ code: 0 })
      expect((await callRpc<{ version: number }>(port, 'application.captureResourceAuthoring', { resourceId: created.resource.id })).version).toBe(initial.version)
      const filename = join(directory, 'resource.yaml')
      const original = await readFile(filename, 'utf8')
      await writeFile(filename, original.replace('Authoring CLI', 'First edit'))
      expect(await cli('check', directory)).toMatchObject({ code: 0 })
      expect(await cli('diff', directory)).toMatchObject({ code: 0 })
      expect(await cli('apply', directory)).toMatchObject({ code: 0 })
      const capture = () => callRpc<{ resource: { id: string; rootNode: { label: string } }; version: number }>(port, 'application.captureResourceAuthoring', { resourceId: created.resource.id })
      const applied = await capture()
      expect(applied.resource).toMatchObject({ id: created.resource.id, rootNode: { label: 'First edit' } })
      expect(await cli('apply', directory)).toMatchObject({ code: 0 })
      expect((await capture()).version).toBe(applied.version)
      expect(await cli('apply', other)).toMatchObject({ code: 3 })
      const child = spawn(process.execPath, ['--import', 'tsx', script, 'watch', directory, '--json'])
      let buffer = '', count = 0
      const waiters: Array<() => void> = []
      child.stdout.on('data', chunk => {
        buffer += String(chunk)
        while (buffer.includes('\n')) { buffer = buffer.slice(buffer.indexOf('\n') + 1); count++; waiters.shift()?.() }
      })
      const next = () => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Watch did not produce a result')), 8000)
        waiters.push(() => { clearTimeout(timer); resolve() })
      })
      try {
        if (!count) await next()
        const changed = next()
        await writeFile(filename, original.replace('Authoring CLI', 'Watch edit'))
        await changed
        expect((await capture()).resource.rootNode.label).toBe('Watch edit')
      } finally { child.kill('SIGTERM'); await once(child, 'close') }
      const after = await capture()
      await writeFile(filename, original.replace('Authoring CLI', 'After close'))
      expect((await capture()).version).toBe(after.version)
      await writeFile(filename, 'invalid: [')
      expect(await cli('apply', directory)).toMatchObject({ code: 2 })
      expect((await capture()).version).toBe(after.version)
    })
  }, 45_000)
})
