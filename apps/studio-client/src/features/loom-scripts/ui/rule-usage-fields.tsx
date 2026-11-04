import { useEffect, useId, useState } from 'react'
import { Button, Toggle } from '@loom-studio/ui'
import { applyTextRuleUsage, type ScriptTextTransformRule, type TextRuleUsage, type TextRuleUsages } from '@loom-studio/shared/loom-scripts'
import styles from './script-management-panel.module.scss'

export function RuleUsageFields({ mountId, rules, saved, disabled, onSave, onDirtyChange }: {
  mountId: string
  rules: Array<{ id: string; rule: ScriptTextTransformRule }>
  saved: TextRuleUsages
  disabled?: boolean
  onDirtyChange(mountId: string, dirty: boolean): void
  onSave(value: TextRuleUsages): Promise<void>
}) {
  const fieldId = useId()
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string>()
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  useEffect(() => { onDirtyChange(mountId, dirty); return () => onDirtyChange(mountId, false) }, [mountId, dirty, onDirtyChange])
  function change(id: string, key: keyof TextRuleUsage, value: TextRuleUsage[keyof TextRuleUsage]) {
    const next = { ...draft[id], [key]: value }
    if (value === undefined) delete next[key]
    setDraft({ ...draft, [id]: next })
  }
  return <fieldset className={styles.settings} disabled={disabled}>
    <legend>规则使用配置</legend>
    <p className={styles.muted}>只影响此采用范围。保存后生效，不修改源码；未覆盖的选项跟随已采用版本的默认值。</p>
    {rules.map(({ id, rule }) => {
      const usage = draft[id] ?? {}
      const reset = (key: keyof TextRuleUsage) => <Button size="small" variant="ghost" disabled={!Object.hasOwn(usage, key)} onClick={() => change(id, key, undefined)}>恢复默认</Button>
      return <section key={id}>
        {rules.length > 1 && <h4>{rule.name}</h4>}
        <div className={styles.ruleDepths}>
          {(['minDepth', 'maxDepth'] as const).map(key => <div className={styles.setting} key={key}>
            <div className={styles.settingHeading}>
              <label htmlFor={`${fieldId}-${id}-${key}`}>{key === 'minDepth' ? '最小深度' : '最大深度'}</label>{reset(key)}
            </div>
            <input id={`${fieldId}-${id}-${key}`} data-loom-ui-text-input="" type="number" min={0} step={1} placeholder={key === 'minDepth' ? '0' : '不限'}
              value={Object.hasOwn(usage, key) ? usage[key] ?? '' : rule.range?.[key] ?? ''}
              onChange={event => change(id, key, event.target.value === '' ? null : Number(event.target.value))} />
          </div>)}
        </div>
        <p className={styles.muted}>最新消息为 0，向前逐条递增；两端均包含。</p>
        {(['targets', 'phases'] as const).map(key => <div className={styles.setting} key={key}>
          <div className={styles.settingHeading}><span>{key === 'targets' ? '作用对象' : '处理阶段'}</span>{reset(key)}</div>
          <div className={styles.ruleOptions}>
            {(key === 'targets' ? ['narrative', 'agent-session'] as const : ['classify', 'display', 'prompt'] as const).map(value => {
              const label = ({ narrative: '剧情正文', 'agent-session': 'Agent 对话', classify: '持久化分类', display: '显示', prompt: '提示词' })[value]
              return <span className={styles.ruleOption} key={value}><Toggle label={label}
                checked={(usage[key] ?? rule[key] as string[]).includes(value as never)}
                onChange={enabled => {
                  const current: string[] = usage[key] ?? rule[key]
                  change(id, key, (enabled ? [...current, value] : current.filter(item => item !== value)) as TextRuleUsage[typeof key])
                }} /><span>{label}</span></span>
            })}
          </div>
        </div>)}
        <div className={styles.setting}><div className={styles.settingHeading}>
          <span className={styles.ruleOption}><Toggle label="流式处理" checked={usage.streaming ?? rule.streaming ?? false} onChange={value => change(id, 'streaming', value)} /><span>流式处理</span></span>{reset('streaming')}
        </div></div>
      </section>
    })}
    {error && <p role="alert">{error}</p>}
    <Button size="small" disabled={!dirty} onClick={async () => {
      try {
        for (const { id, rule } of rules) {
          const usage = draft[id]
          if (usage?.targets?.length === 0 || usage?.phases?.length === 0) throw new Error('至少选择一个作用对象和处理阶段')
          applyTextRuleUsage(rule, usage)
        }
        setError(undefined)
        await onSave(draft)
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }}>保存规则配置</Button>
    {dirty && <Button size="small" variant="ghost" onClick={() => { setDraft(saved); setError(undefined) }}>放弃修改</Button>}
  </fieldset>
}
