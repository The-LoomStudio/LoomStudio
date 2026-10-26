import { useState } from 'react'
import { Button } from '@loom-studio/ui'
import { StartupReady } from '../app/startup-curtain.js'
import { PresetLibraryWorkbench } from '../features/prompt-resources/ui/preset-library/preset-library-workbench.js'
import type { PresetLibraryItem, PresetLibraryNode } from '../features/prompt-resources/ui/preset-library/preset-library-model.js'
import { copyPresetSampleContent, createPresetLibrarySamples, presetLibraryModels, presetLibraryTools, presetLibraryResources, presetLibrarySources } from './preset-library-fixtures.js'
import styles from './preset-library-preview.module.scss'

type Scene = 'normal' | 'empty' | 'many'
export function PresetLibraryPreview() {
  const [scene, setScene] = useState<Scene>('normal')
  const [revision, setRevision] = useState(0)
  return <main className={styles.host}><StartupReady /><header className={styles.toolbar}><strong>预设库 · DEV PREVIEW</strong><span>内存样例 · 刷新后重置</span><div>{(['normal', 'empty', 'many'] as const).map(value => <Button key={value} size="small" variant="ghost" aria-pressed={scene === value} onClick={() => setScene(value)}>{{ normal: '正常', empty: '空列表', many: '较多内容' }[value]}</Button>)}<Button size="small" variant="ghost" onClick={() => setRevision(value => value + 1)}>重置</Button></div></header><div className={styles.panel}><SampleWorkbench key={`${scene}-${revision}`} scene={scene} /></div></main>
}
function SampleWorkbench({ scene }: { scene: Scene }) {
  const [presets, setPresets] = useState(() => createPresetLibrarySamples(scene))
  const [beforeCopy, setBeforeCopy] = useState<PresetLibraryItem[]>()
  return <PresetLibraryWorkbench models={presetLibraryModels} tools={presetLibraryTools} presets={presets} sources={presetLibrarySources} resources={scene === 'empty' ? [] : presetLibraryResources}
    onConfigure={(presetId, patch) => {
      setPresets(items => items.map(item => item.id === presetId ? { ...item, ...patch } : item))
      setBeforeCopy(undefined)
    }}
    onCreate={() => {
      const id = crypto.randomUUID()
      setPresets(items => [...items, { id, sourceId: 'personal', name: `新预设 ${items.filter(p => p.sourceId === 'personal').length + 1}`, description: '从简单的消息骨架开始，逐步加入自己的偏好。', tag: '个人', toolIds: [], resourceIds: [], nodes: [
        { id: `${id}-system`, kind: 'message', label: '写作要求', role: 'system', children: [{ id: `${id}-entry`, kind: 'entry', label: '基本要求', body: '在这里写下你的创作要求。' }] },
        { id: `${id}-session`, kind: 'sequence', label: '会话历史' },
      ] }])
      setBeforeCopy(undefined)
      return id
    }}
    onEdit={(presetId, nodeId, body) => {
      const update = (nodes: PresetLibraryNode[]): PresetLibraryNode[] => nodes.map(node => node.id === nodeId ? { ...node, body } : { ...node, children: node.children && update(node.children) })
      setPresets(items => items.map(item => item.id === presetId ? { ...item, nodes: update(item.nodes) } : item))
      setBeforeCopy(undefined)
    }}
    onToggleResource={(presetId, resourceId) => {
      setPresets(items => items.map(item => item.id === presetId ? { ...item, resourceIds: item.resourceIds.includes(resourceId) ? item.resourceIds.filter(id => id !== resourceId) : [...item.resourceIds, resourceId] } : item))
      setBeforeCopy(undefined)
    }}
    onCopy={request => { setBeforeCopy(presets); setPresets(copyPresetSampleContent(presets, request)) }}
    canUndoCopy={!!beforeCopy}
    onUndoCopy={() => { if (beforeCopy) setPresets(beforeCopy); setBeforeCopy(undefined) }}
  />
}
