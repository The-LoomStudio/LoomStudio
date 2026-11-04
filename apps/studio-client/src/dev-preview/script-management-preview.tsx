import { useMemo, useState } from 'react'
import { Button } from '@loom-studio/ui'
import { StartupReady } from '../app/startup-curtain.js'
import { ScriptManagementPanel } from '../features/loom-scripts/ui/script-management-panel.js'
import { createTranslator } from '../shared/i18n/index.js'
import { createScriptManagementPreviewApi } from './script-management-fixtures.js'
import styles from './script-management-preview.module.scss'

const t = createTranslator('zh-CN')
export function ScriptManagementPreview() {
  const [scene, setScene] = useState<'normal' | 'empty' | 'many'>('normal')
  const api = useMemo(() => createScriptManagementPreviewApi(scene), [scene])
  return <main className={styles.host}>
    <StartupReady />
    <header className={styles.toolbar}><strong>脚本管理 · 交互预览</strong><span>仅内存示例，不执行脚本</span>
      {(['normal', 'empty', 'many'] as const).map(value => <Button size="small" key={value} aria-pressed={scene === value} onClick={() => setScene(value)}>{{ normal: '正常', empty: '空列表', many: '较多脚本' }[value]}</Button>)}
    </header>
    <div className={styles.panel}><ScriptManagementPanel endpoint={`preview:${scene}`} key={scene} api={api} cardId="preview-card" onScriptsChanged={() => {}} t={t} header={<strong className={styles.label}>脚本</strong>} /></div>
  </main>
}
