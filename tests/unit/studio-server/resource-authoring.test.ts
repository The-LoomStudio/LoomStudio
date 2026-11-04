import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { AuthoringResource } from '@loom-studio/shared'
import { loadResourceAuthoring, projectResourceAuthoring, restoreResourceAuthoring, writeResourceAuthoring } from '../../../apps/studio-server/src/codecs/resource-authoring.js'

const resource: AuthoringResource = {
  format: 'loom.resource.authoring', schemaVersion: 1, id: 'preset-1', resourceKind: 'preset',
  useGlobalLore: false, macros: { user: '哥哥' },
  metadata: { icon: { kind: 'package', packageId: 'official.assistant', path: 'assets/avatar.png' } },
  rootNode: { id: 'root', kind: 'module', label: '助手', body: '容器原文', extra: { custom: { flag: true } }, children: [
    { id: 'message', kind: 'message', label: '系统消息', capabilities: { roleHint: 'system', activation: { kind: 'always' } }, children: [
      { id: 'entry', kind: 'entry', label: '行为/说明.md', enabled: false, body: '# 正文\n\n---\n保留换行\n', extra: { custom: [1, 'x'] } },
      { id: 'anchor', kind: 'virtual', label: '知识', capabilities: { targetAnchorId: '@lore.stable' } },
    ] },
    { id: 'history', kind: 'virtual', label: '历史', capabilities: { targetAnchorId: '@chat.session' } },
  ] },
}
const decode = (value: Uint8Array) => new TextDecoder().decode(value)
const encode = (value: string) => new TextEncoder().encode(value)

describe('resource authoring directories', () => {
  it('round trips Preset nodes and reference-only icons with readable paths', () => {
    const files = projectResourceAuthoring(resource)
    expect([...files.keys()]).toContain('010-行为%2F说明%2Emd.md')
    expect(restoreResourceAuthoring(files)).toEqual(resource)
    expect(decode(files.get('resource.yaml')!)).not.toContain('children:')
    expect(decode(files.get('composition.xml')!)).toContain('<Message id="message" name="系统消息" role="system">')
    expect(decode(files.get('resource.yaml')!)).not.toContain('roleHint')
  })
  it('round trips Lore folders and preserves identities after rename/reorder', () => {
    const lore: AuthoringResource = { ...resource, resourceKind: 'lore', rootNode: { id: 'r', kind: 'module', label: 'Lore', children: [
      { id: 'folder', kind: 'folder', label: '爱丽丝', body: 'folder text', children: [
        { id: 'a', kind: 'entry', label: '摘要', body: '摘要' },
        { id: 'b', kind: 'entry', label: '详情', body: '详情' },
      ] },
    ] } }
    const files = projectResourceAuthoring(lore)
    expect(restoreResourceAuthoring(files)).toEqual(lore)
    files.set('010-爱丽丝/005-新名.md', files.get('010-爱丽丝/020-详情.md')!)
    files.delete('010-爱丽丝/020-详情.md')
    const children = restoreResourceAuthoring(files).rootNode.children![0].children!
    expect(children.map(node => [node.id, node.label])).toEqual([['b', '新名'], ['a', '摘要']])
  })
  it('uses XML order while retaining file identities and numbered readable paths', () => {
    const files = projectResourceAuthoring(resource)
    const original = '010-行为%2F说明%2Emd.md'
    files.set('020-文风/090-新名称.md', files.get(original)!)
    files.delete(original)
    files.set('composition.xml', encode(decode(files.get('composition.xml')!).replace(`./${original}`, './020-文风/090-新名称.md')))
    const restored = restoreResourceAuthoring(files)
    expect(restored.rootNode.children![0].children![0]).toMatchObject({ id: 'entry', label: '新名称', body: resource.rootNode.children![0].children![0].body })
    const xml = decode(files.get('composition.xml')!)
    files.set('composition.xml', encode(xml.replace(/(    <Entry[^\n]+)\n(    <Slot[^\n]+)/, '$2\n$1')))
    expect(restoreResourceAuthoring(files).rootNode.children![0].children!.map(node => node.id)).toEqual(['anchor', 'entry'])
  })
  it('rejects missing, duplicate and unsafe references and unsupported XML', () => {
    const files = projectResourceAuthoring(resource)
    const xml = decode(files.get('composition.xml')!)
    for (const [replacement, error] of [
      [xml.replace('./010-行为%2F说明%2Emd.md', './999-missing.md'), '999-missing.md'],
      [xml.replace('./010-行为%2F说明%2Emd.md', './../outside.md'), 'Unsafe authoring path'],
      [xml.replace('<Entry', '<Unknown'), 'Unknown element'],
      [xml.replace('<Preset>', '<Preset>正文'), 'cannot contain text'],
      ['<!DOCTYPE Preset [<!ENTITY x "text">]>' + xml, 'DOCTYPE'],
      [xml.replace('role="system"', 'role="system" surprise="true"'), 'Unknown Message attribute'],
      [xml.replace('</Message>', '<Entry src="./010-行为%2F说明%2Emd.md" /></Message>'), 'Duplicate Entry reference'],
      [xml.replace('anchor="@lore.stable"', 'anchor="@chat.session"'), 'Invalid child placement'],
    ]) {
      files.set('composition.xml', encode(replacement!))
      expect(() => restoreResourceAuthoring(files)).toThrow(error)
    }
    files.set('composition.xml', encode(xml))
    files.set('resource.yaml', encode(decode(files.get('resource.yaml')!) + 'delivery: stream\n'))
    expect(() => restoreResourceAuthoring(files)).toThrow('resource.yaml')
  })
  it('still reads legacy Message directories and rejects duplicate YAML keys', () => {
    const files = new Map([
      ['resource.yaml', encode('format: loom.resource.authoring\nschemaVersion: 1\nid: old\nresourceKind: preset\nrootNode: { id: root, kind: module, label: Old }\n')],
      ['010-System.system.message/message.yaml', encode('id: msg\n')],
      ['010-System.system.message/010-正文.md', encode('---\nid: text\n---\nHello')],
    ])
    expect(restoreResourceAuthoring(files).rootNode.children![0]).toMatchObject({ id: 'msg', kind: 'message', capabilities: { roleHint: 'system' }, children: [{ id: 'text', body: 'Hello' }] })
    files.set('010-System.system.message/message.yaml', encode('id: x\nid: y\n'))
    expect(() => restoreResourceAuthoring(files)).toThrow('010-System.system.message/message.yaml')
  })
  it('loads and writes actual directories, excludes binding state and refuses overwrites/symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-authoring-'))
    try {
      await writeResourceAuthoring(directory, resource)
      await mkdir(join(directory, '.loom'))
      await writeFile(join(directory, '.loom', 'authoring-state.json'), '{}')
      expect(await loadResourceAuthoring(directory)).toEqual(resource)
      const before = await readFile(join(directory, 'resource.yaml'), 'utf8')
      await expect(writeResourceAuthoring(directory, resource)).rejects.toThrow('must be empty')
      expect(await readFile(join(directory, 'resource.yaml'), 'utf8')).toBe(before)
      await symlink(join(directory, 'resource.yaml'), join(directory, '030-link.md'))
      await expect(loadResourceAuthoring(directory)).rejects.toThrow('Symbolic links')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
