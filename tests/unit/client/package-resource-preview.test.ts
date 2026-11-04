import { expect, it } from 'vitest'
import { summarizePackageResource } from '../../../packages/shared/src/package-resource-summary.js'
import { previewPackageResource } from '../../../apps/studio-client/src/features/extension-renderers/model/package-resource-preview.js'

it('keeps card metadata while excluding inline bodies, and preserves detail sections', () => {
  const source = JSON.stringify({ rootNode: { label: 'Preset', meta: 'Description', children: [{ label: 'Entry', body: 'Full prompt body' }] } })
  expect(summarizePackageResource('preset', source)).toEqual({ title: 'Preset', description: 'Description' })
  const detail = previewPackageResource({ id: 'p', kind: 'preset', source: 'resources/p.json', declaration: {} }, source)
  expect(detail).toMatchObject({ title: 'Preset', description: 'Description', source,
    sections: [{ label: 'Preset / Entry', body: 'Full prompt body' }] })
})

it('keeps files.v1 bodies as lazy file references and preserves CSS swatches', () => {
  const source = JSON.stringify({ schema: 'loom.promptResource.files.v1', rootNode: {
    metadata: { label: 'Files', meta: 'File description' }, children: [{ metadata: { label: 'Entry' }, body: 'entry.md' }],
  } })
  expect(summarizePackageResource('lore', source)).toEqual({ title: 'Files', description: 'File description' })
  expect(previewPackageResource({ id: 'p', kind: 'lore', source: 'resources/index.json', declaration: {} }, source).sections)
    .toEqual([{ label: 'Files / Entry', source: 'resources/entry.md' }])
  const css = ':root { --loom-color-background: #abc; --loom-color-accent: #112233; --loom-color-text: #abc; }'
  expect(summarizePackageResource('theme', css)).toEqual({ swatches: ['#abc', '#112233'] })
  expect(previewPackageResource({ id: 't', kind: 'theme', source: 't.css', declaration: {} }, css).swatches).toEqual(['#abc', '#112233'])
})

it('reads script metadata without running code and preserves rule detail facts', () => {
  const script = '// ==LoomScript==\n// @format 1\n// @id example.script\n// @name Example\n// @version 1.0.0\n// @runtime client\n// ==/LoomScript==\nthrow new Error("must not execute")'
  expect(summarizePackageResource('script', script)).toEqual({ title: 'Example' })
  const source = JSON.stringify({ name: 'Rule', description: 'Summary', matcher: { pattern: 'text', flags: 'g' }, effect: { kind: 'replace', replacement: 'body' } })
  expect(summarizePackageResource('rule', source)).toEqual({ title: 'Rule', description: 'Summary' })
  expect(previewPackageResource({ id: 'r', kind: 'rule', source: 'r.json', declaration: {} }, source).facts)
    .toEqual([{ kind: 'pattern', value: '/text/g' }, { kind: 'effect', value: 'replace' }])
})
