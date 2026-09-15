import { Copy, Plus, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Checkbox, Field, IconButton, SearchField, TextInput, Textarea, Toggle } from '@loom-studio/ui'
import styles from './ui-primitives-preview.module.scss'

export function UiPrimitivesPreview() {
  const [enabled, setEnabled] = useState(true)
  const [query, setQuery] = useState('')

  return (
    <main className={styles.page}>
      <header><div><small>@loom-studio/ui</small><h1>基础控件</h1></div></header>
      <section>
        <h2>操作</h2>
        <div className={styles.row}>
          <Button size="small" variant="ghost"><Plus aria-hidden="true" />新增</Button>
          <IconButton aria-label="复制"><Copy aria-hidden="true" /></IconButton>
          <Button size="small" variant="danger"><Trash2 aria-hidden="true" />删除</Button>
          <Button size="small" disabled>处理中</Button>
          <IconButton aria-label="设置" title="设置"><Settings aria-hidden="true" /></IconButton>
        </div>
      </section>
      <section className={styles.fields}>
        <h2>字段</h2>
        <Field id="preview-name" label="名称">
          {controlProps => <TextInput {...controlProps} defaultValue="Loom Studio" />}
        </Field>
        <Field id="preview-error" label="带错误的字段" error="名称不能为空">
          {controlProps => <TextInput {...controlProps} defaultValue="" />}
        </Field>
        <SearchField aria-label="搜索组件" clearLabel="清空搜索" placeholder="搜索组件" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
        <label className={styles.inline}><Checkbox checked={enabled} onChange={event => setEnabled(event.target.checked)} />复选框</label>
        <span className={styles.inline}><Toggle checked={enabled} label="启用" onChange={setEnabled} />启用</span>
        <Field id="preview-content" label="内容">
          {controlProps => <Textarea {...controlProps} defaultValue="角色设定与描述" />}
        </Field>
      </section>
    </main>
  )
}
