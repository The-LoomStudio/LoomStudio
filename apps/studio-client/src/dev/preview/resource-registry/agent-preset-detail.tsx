import { Anchor, FileText, Wrench } from 'lucide-react'
import { Button, Toggle } from '@loom-studio/ui'
import styles from './resource-registry-workbench.module.scss'

export type RegistryAgentPreset = {
  model: string
  prompts: Array<{ id: string; name: string; kind: 'text' | 'anchor'; body: string }>
  tools: Array<{
    id: string
    name: string
    owner: string
    description: string
    enabled: boolean
  }>
}

export function AgentPresetDetail(props: {
  name: string
  preset: RegistryAgentPreset
  section: 'overview' | 'prompt' | 'tools' | 'model'
  models: string[]
  readOnly?: boolean
  onChange(preset: RegistryAgentPreset): void
  onSelectPrompt(id: string): void
}) {
  return <section className={styles.agentDetail} aria-label={`${props.name}配置`}>
    {props.section === 'overview' && <div className={styles.documentHeader}>
      <h2>{props.name}</h2>
      <span>{props.preset.prompts.length} 个编排节点 · {props.preset.tools.filter(tool => tool.enabled).length} 个工具启用</span>
    </div>}
    {(props.section === 'model' || props.section === 'overview') && <div className={styles.profileFields}>
      <label>
        <span>模型槽</span>
        <select aria-label={`${props.name}模型槽`} value={props.preset.model} disabled={props.readOnly}
          onChange={event => props.onChange({ ...props.preset, model: event.target.value })}>
          <option value="">未绑定</option>
          {props.models.map(model => <option key={model}>{model}</option>)}
        </select>
      </label>
      <span className={styles.modelBinding}>本地绑定</span>
    </div>}
    {(props.section === 'prompt' || props.section === 'overview') && <ol className={styles.promptOutline} aria-label={`${props.name}提示词编排`}>
      {props.preset.prompts.map(prompt => <li key={prompt.id}>
        <Button onClick={() => props.onSelectPrompt(prompt.id)}>
          {prompt.kind === 'anchor' ? <Anchor size={15} /> : <FileText size={15} />}
          {prompt.name}
        </Button>
      </li>)}
    </ol>}
    {props.section === 'tools' && <div className={styles.profileTools}>
      <div className={styles.documentHeader}>
        <h3>工具</h3>
        <span>{props.preset.tools.filter(tool => tool.enabled).length} / {props.preset.tools.length} 项启用</span>
      </div>
      {props.preset.tools.map(tool => <div className={styles.profileTool} key={tool.id}>
          <Wrench size={16} aria-hidden="true" />
          <div className={styles.toolText}>
            <strong>{tool.name}</strong>
            <small>{tool.owner}</small>
            <p>{tool.description}</p>
          </div>
          <Toggle
            label={`${props.name}启用${tool.name}`}
            checked={tool.enabled}
            disabled={props.readOnly}
            onChange={enabled => props.onChange({
              ...props.preset,
              tools: props.preset.tools.map(item => item.id === tool.id ? { ...item, enabled } : item),
            })}
          />
        </div>)}
      {props.preset.tools.length === 0 && <p className={styles.empty}>当前 Agent 预设未挂载工具</p>}
    </div>}
  </section>
}
