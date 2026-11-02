import { useWorkbenchView } from '../../../../shared/studio-shell/use-workbench-view.js'
import { useId, useState } from 'react'
import { Checkbox, SearchField } from '@loom-studio/ui'
import type { PresetLibraryConfiguration, PresetLibraryItem, PresetLibraryOption, PresetLibraryResource, PresetLibrarySource } from './preset-library-model.js'
import modelStyles from '../agent-model-editor.module.scss'
import styles from './preset-library-workbench.module.scss'

type Props = {
  preset: PresetLibraryItem
  models: PresetLibraryOption[]
  tools: PresetLibraryOption[]
  resources: PresetLibraryResource[]
  sources: PresetLibrarySource[]
  onConfigure(patch: Partial<PresetLibraryConfiguration>): void
  onToggleResource(resourceId: string): void
}
const approvalScopes = [
  ['workspaceWrite', '共享工作区写入'], ['resourceWrite', '设定资源修改'], ['stateWrite', 'State 修改'],
  ['narrativeWrite', '剧情修改'], ['historyRead', '剧情历史读取'], ['authorMode', '启用作者模式'],
] as const
const configurationTabs = ['模型与审批', 'Lore', '正则 / 提取器', '工具', '脚本 / 模块'] as const

/** Live configuration content hosted in the library overlay; the caller owns all changes. */
export function PresetLibraryConfig(props: Props) {
  const { preset } = props
  const [tab, setTab] = useWorkbenchView<(typeof configurationTabs)[number]>('preset.library-configuration', '模型与审批', configurationTabs)
  const [query, setQuery] = useState('')
  const tabId = useId()
  const matching = (name: string, sourceName = '') => `${name} ${sourceName}`.toLowerCase().includes(query.trim().toLowerCase())
  const resources = props.resources.filter(resource =>
    (tab === 'Lore' ? resource.kind === 'Lore' : tab === '正则 / 提取器' ? resource.kind === '正则' : tab === '脚本 / 模块' ? resource.kind === '脚本' || resource.kind === '模块' : false)
    && matching(resource.name, props.sources.find(item => item.id === resource.sourceId)?.name))
  const tools = props.tools.filter(tool => matching(tool.name))
  return <section className={styles.configuration} aria-label={`${preset.name}的配置`}>
        <div className={styles.resourceTabs} role="tablist" aria-label="预设配置类别">{configurationTabs.map((value, index) => <button key={value} id={`${tabId}-tab-${index}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${tabId}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value); setQuery('') }} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % configurationTabs.length : event.key === 'ArrowLeft' ? (index + configurationTabs.length - 1) % configurationTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? configurationTabs.length - 1 : undefined
          if (next === undefined) return
          event.preventDefault(); setTab(configurationTabs[next]); setQuery('')
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>{value}</button>)}</div>
      <div key={tab} id={`${tabId}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${tabId}-tab-${configurationTabs.indexOf(tab)}`} className={styles.configurationPanel}>
        {tab === '模型与审批' ? (
      <div className={`${modelStyles.toolForm} ${modelStyles.presetModelForm} loom-underlined-fields`}>
        <label className={styles.configModel}><strong>模型</strong><select value={preset.modelId ?? ''} onChange={event => props.onConfigure({ modelId: event.target.value || undefined })}>
          <option value="">未绑定</option>{props.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <Checkbox checked={(preset.delivery ?? 'stream') === 'stream'} onChange={event => props.onConfigure({ delivery: event.target.checked ? 'stream' : 'complete' })} label="流式输出" />
        <fieldset className={modelStyles.approvals}><legend>工具访问审批</legend><p>控制工具申请的写入、历史读取及作者模式审批。自动允许不扩大数据访问范围；修改在后续运行中生效。</p>
          {approvalScopes.map(([scope, label]) => <label key={scope}><span>{label}</span><select aria-label={label} value={preset.approvalPolicy?.[scope] ?? 'ask'} onChange={event => {
            const mode = event.target.value as 'ask' | 'allow' | 'deny'
            props.onConfigure({ approvalPolicy: { ...preset.approvalPolicy, [scope]: mode } })
          }}><option value="ask">每次询问</option><option value="allow">自动允许</option><option value="deny">禁止</option></select></label>)}
        </fieldset>
      </div>
        ) : <div className={styles.resourceConfigPanel}>
          {tab === 'Lore' && <div className={styles.loreSources}>
            <Checkbox checked={preset.useGlobalLore ?? true} onChange={event => props.onConfigure({ useGlobalLore: event.target.checked })} label="使用全局世界书" />
            <Checkbox checked={preset.useCharacterLore ?? true} onChange={event => props.onConfigure({ useCharacterLore: event.target.checked })} label="使用角色世界书" />
          </div>}
          <SearchField aria-label="搜索资源名称或来源" placeholder="搜索名称或来源" clearLabel="清空搜索" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
          {tab === '工具' ? <div className={styles.configurationChoices}>{tools.map(tool => <Checkbox key={tool.id} checked={preset.toolIds.includes(tool.id)} onChange={() => props.onConfigure({ toolIds: preset.toolIds.includes(tool.id) ? preset.toolIds.filter(id => id !== tool.id) : [...preset.toolIds, tool.id] })} label={<><strong>{tool.name}</strong><small>{tool.description}</small></>} />)}</div> : props.sources.map(item => {
            const entries = resources.filter(resource => resource.sourceId === item.id)
            return entries.length ? <section key={item.id} className={styles.configurationChoices}><h3>{item.name}</h3>{entries.map(resource => <Checkbox key={resource.id} checked={preset.resourceIds.includes(resource.id)} onChange={() => props.onToggleResource(resource.id)} label={<><strong>{resource.name}<span className={styles.badge}>{resource.kind}</span></strong><small>{resource.description}</small></>} />)}</section> : null
          })}
          {!(tab === '工具' ? tools.length : resources.length) && <p className={styles.hint}>{query ? '没有匹配的资源。' : '暂无可用资源。'}</p>}
        </div>}
      </div>
  </section>
}
