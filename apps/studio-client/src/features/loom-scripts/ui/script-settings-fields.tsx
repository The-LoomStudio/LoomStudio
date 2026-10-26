import { Button, Toggle } from '@loom-studio/ui'
import type { LoomScriptSettingDefinition, LoomScriptSettings } from '@loom-studio/shared/loom-scripts'
import { useId } from 'react'
import styles from './script-management-panel.module.scss'

export function ScriptSettingsFields(props: {
  definitions: readonly LoomScriptSettingDefinition[]
  values: LoomScriptSettings
  inherited?: LoomScriptSettings
  dirty: boolean
  disabled?: boolean
  pendingApply?: boolean
  onChange(values: LoomScriptSettings): void
  onSave(): void
  onDiscard(): void
}) {
  const id = useId()
  if (!props.definitions.length && !Object.keys(props.values).length && !props.dirty) return null
  return <fieldset className={styles.settings} disabled={props.disabled}>
    <legend>脚本配置</legend>
    <p className={styles.muted}>配置保存在此范围，不修改源码。保存后刷新脚本生效；尚未启用时，下次启用生效。</p>
    {props.definitions.map(definition => {
      const overridden = Object.hasOwn(props.values, definition.key)
      const value = props.values[definition.key] ?? props.inherited?.[definition.key] ?? definition.default
      const inputId = `${id}-${definition.key}`
      const change = (next: string | number | boolean) => props.onChange({ ...props.values, [definition.key]: next })
      return <div className={styles.setting} key={definition.key}>
        <div className={styles.settingHeading}>{definition.type === 'boolean' ? <span>{definition.label}</span> : <label htmlFor={inputId}>{definition.label}</label>}
          <Button size="small" variant="ghost" disabled={props.disabled || !overridden} onClick={() => { const next = { ...props.values }; delete next[definition.key]; props.onChange(next) }}>恢复继承 / 默认</Button>
        </div>
        {definition.type === 'boolean'
          ? <Toggle label={definition.label} checked={Boolean(value)} disabled={props.disabled} onChange={change} />
          : definition.type === 'select'
            ? <select id={inputId} value={String(value)} aria-describedby={definition.description ? `${inputId}-help` : undefined} onChange={event => change(event.target.value)}>
              {definition.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            : <input id={inputId} type={definition.type === 'number' ? 'number' : 'text'} value={String(value)} min={definition.min} max={definition.max} step={definition.type === 'number' ? 'any' : undefined}
              aria-describedby={definition.description ? `${inputId}-help` : undefined}
              onChange={event => change(definition.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}
        {definition.description && <p id={`${inputId}-help`} className={styles.muted}>{definition.description}</p>}
        {!overridden && <small className={styles.muted}>{props.inherited?.[definition.key] !== undefined ? '继承全局配置' : '使用作者默认值'}</small>}
      </div>
    })}
    <div className={styles.actions}>
      <Button size="small" disabled={props.disabled || !props.dirty} onClick={props.onSave}>保存配置</Button>
      {Object.keys(props.values).length > 0 && <Button size="small" variant="ghost" disabled={props.disabled} onClick={() => props.onChange({})}>全部恢复继承 / 默认</Button>}
      {props.dirty && <Button size="small" variant="ghost" disabled={props.disabled} onClick={props.onDiscard}>放弃配置修改</Button>}
      {props.pendingApply && <span className={styles.muted}>已保存配置，刷新后生效。</span>}
    </div>
  </fieldset>
}
