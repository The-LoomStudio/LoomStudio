import { useState } from 'react'
import { Button } from '@loom-studio/ui'
import { StartupReady } from '../app/startup-curtain.js'
import { ObservabilityWorkbench } from '../widgets/observability-workbench/observability-workbench.js'
import { observationScene, type ObservationScene } from './observability-fixtures.js'
import styles from './observability-preview.module.scss'

const scenes: Array<{ id: ObservationScene; label: string }> = [
  { id: 'normal', label: '正常记录' }, { id: 'running', label: '运行中' }, { id: 'failed', label: '请求失败' },
  { id: 'empty', label: '空列表' }, { id: 'many', label: '较多记录' },
]
export function ObservabilityPreview() {
  const requested = new URLSearchParams(window.location.search).get('scene')
  const [scene, setScene] = useState<ObservationScene>(scenes.find(item => item.id === requested)?.id ?? 'normal')
  const [revision, setRevision] = useState(0)
  return <div className={styles.host}>
    <ObservabilityWorkbench key={`${scene}-${revision}`} records={observationScene(scene)} toolbar={<div className={styles.toolbar}>
      <span className={styles.badge}>UI 草稿 · 示例数据</span>
      <label>场景<select aria-label="预览场景" value={scene} onChange={event => {
        const next = scenes.find(item => item.id === event.target.value)
        if (next) setScene(next.id)
      }}>{scenes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <Button size="small" onClick={() => setRevision(value => value + 1)}>重置交互</Button>
    </div>} />
    <StartupReady />
  </div>
}
