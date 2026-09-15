import { Checkbox, Field, TextInput, Textarea, type FieldControlProps } from '@loom-studio/ui'
import type {
  ExtensionConfigEntry,
  ExtensionSettingContribution,
  ExtensionStorageScope,
  JsonValue,
} from '@loom-studio/extension-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './extension-settings-form.module.scss'

const TEXT_COMMIT_DELAY_MS = 450

export function ExtensionSettingsForm(props: {
  api: Pick<StudioApi['extensionRuntime'], 'getConfig' | 'listConfigs' | 'upsertConfig'>
  configRevision: number
  packageId: string
  scopeContext: { cardId?: string; timelineId?: string; agentSessionId?: string }
  settings: readonly ExtensionSettingContribution[]
  t: Translator
}) {
  const resolved = useMemo(() => props.settings
    .map(setting => ({ setting, scope: resolveSettingScope(setting, props.scopeContext) }))
    .sort((left, right) => (left.setting.suggestedOrder ?? 0) - (right.setting.suggestedOrder ?? 0)
      || left.setting.label.localeCompare(right.setting.label)), [props.scopeContext, props.settings])
  const [entries, setEntries] = useState<Record<string, ExtensionConfigEntry>>({})
  const [loadError, setLoadError] = useState<string>()
  const scopeSignature = JSON.stringify(resolved.flatMap(item => item.scope ? [item.scope] : []))

  useEffect(() => {
    let disposed = false
    const scopes = uniqueScopes(resolved.flatMap(item => item.scope ? [item.scope] : []))
    void Promise.all(scopes.map(async scope => await props.api.listConfigs({ packageId: props.packageId, scope })))
      .then(results => {
        if (disposed) return
        setEntries(Object.fromEntries(results.flatMap(result => result.configs).map(entry => [configKey(entry.scope, entry.key), entry])))
        setLoadError(undefined)
      }, error => {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { disposed = true }
  }, [props.api, props.configRevision, props.packageId, scopeSignature])

  const groups = groupSettings(resolved)
  return (
    <article className={styles.settings} data-loom-component="extension-settings-form">
      <header>
        <h3>{props.t('renderer.settings')}</h3>
        <p>{props.t('renderer.settingsDescription')}</p>
      </header>
      {loadError ? <p className={styles.loadError} role="alert">{loadError}</p> : null}
      {groups.map(group => (
        <section className={styles.group} key={group.name}>
          {group.label ? <h4>{group.label}</h4> : null}
          {group.items.map(({ setting, scope }) => scope ? (
            <SettingField
              entry={entries[configKey(scope, setting.id)]}
              key={`${configKey(scope, setting.id)}:${setting.type}`}
              setting={setting}
              t={props.t}
              onCommit={async (value, expectedVersion) => {
                try {
                  const result = await props.api.upsertConfig({
                    packageId: props.packageId,
                    scope,
                    key: setting.id,
                    value,
                    ...(expectedVersion === undefined ? {} : { expectedVersion }),
                  })
                  setEntries(current => ({ ...current, [configKey(scope, setting.id)]: result.config }))
                  return result.config
                } catch (error) {
                  try {
                    const latest = await props.api.getConfig({ packageId: props.packageId, scope, key: setting.id })
                    if (latest.config) setEntries(current => ({ ...current, [configKey(scope, setting.id)]: latest.config! }))
                  } catch {
                    // Preserve the write failure; refreshing the competing version is best-effort recovery.
                  }
                  throw error
                }
              }}
            />
          ) : (
            <Field id={`extension-setting-${setting.id}`} key={setting.id} label={setting.label} description={setting.description} error={props.t('renderer.settingScopeUnavailable')}>
              {controlProps => <input {...controlProps} disabled value="" />}
            </Field>
          ))}
        </section>
      ))}
    </article>
  )
}

function SettingField(props: {
  entry?: ExtensionConfigEntry
  setting: ExtensionSettingContribution
  t: Translator
  onCommit(value: JsonValue, expectedVersion?: number): Promise<ExtensionConfigEntry>
}) {
  const inputId = `extension-setting-${props.setting.id}`
  const [draft, setDraftState] = useState<boolean | string>(() => toDraft(props.setting, props.entry?.value ?? props.setting.default))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const draftRef = useRef(draft)
  const dirtyRef = useRef(dirty)
  const versionRef = useRef(props.entry?.version)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queuedRef = useRef<JsonValue | undefined>(undefined)
  const hasQueuedRef = useRef(false)
  const savingRef = useRef(false)

  useEffect(() => {
    versionRef.current = props.entry?.version
    if (dirtyRef.current || savingRef.current) return
    const nextDraft = toDraft(props.setting, props.entry?.value ?? props.setting.default)
    draftRef.current = nextDraft
    dirtyRef.current = false
    setDraftState(nextDraft)
    setDirty(false)
  }, [props.entry?.value, props.entry?.version, props.setting])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  function setDraft(value: boolean | string): void {
    draftRef.current = value
    dirtyRef.current = true
    setDraftState(value)
    setDirty(true)
    setError(undefined)
  }

  async function drainQueue(): Promise<void> {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      while (hasQueuedRef.current) {
        const value = queuedRef.current!
        hasQueuedRef.current = false
        try {
          const entry = await props.onCommit(value, versionRef.current)
          versionRef.current = entry.version
          if (!hasQueuedRef.current && sameDraftValue(props.setting, draftRef.current, value)) {
            dirtyRef.current = false
            setDirty(false)
          }
          setError(undefined)
        } catch (reason) {
          hasQueuedRef.current = false
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function commit(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!dirtyRef.current) return
    const parsed = parseSettingValue(props.setting, draftRef.current, props.t)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    queuedRef.current = parsed.value
    hasQueuedRef.current = true
    void drainQueue()
  }

  function scheduleCommit(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(commit, TEXT_COMMIT_DELAY_MS)
  }

  const status = saving ? props.t('renderer.settingSaving') : dirty && !error ? props.t('renderer.settingUnsaved') : undefined
  function renderControl(fieldControlProps: FieldControlProps) {
    const common = {
      ...fieldControlProps,
      disabled: props.setting.readOnly,
      'aria-busy': saving || undefined,
    }
    if (props.setting.type === 'boolean') {
      return <Checkbox {...common} checked={draft === true} onChange={event => { setDraft(event.currentTarget.checked); commitSoon(commit) }} />
    }
    if (props.setting.type === 'select') {
      return (
        <select {...common} value={String(draft)} onChange={event => { setDraft(event.currentTarget.value); commitSoon(commit) }}>
          {props.setting.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
    }
    if (props.setting.type === 'multiline') {
      return <Textarea {...common} maxLength={props.setting.maxLength} minLength={props.setting.minLength} placeholder={props.setting.placeholder} required={props.setting.required} value={String(draft)} onBlur={commit} onChange={event => { setDraft(event.currentTarget.value); scheduleCommit() }} />
    }
    if (props.setting.type === 'range') {
      return (
        <div className={styles.range}>
          <input {...common} max={props.setting.max} min={props.setting.min} step={props.setting.step} type="range" value={String(draft)} onBlur={commit} onChange={event => setDraft(event.currentTarget.value)} onKeyUp={commit} onPointerUp={commit} />
          <output htmlFor={inputId}>{String(draft)}</output>
        </div>
      )
    }
    if (props.setting.type === 'number') {
      return <input {...common} max={props.setting.max} min={props.setting.min} step={props.setting.step} type="number" value={String(draft)} onBlur={commit} onChange={event => { setDraft(event.currentTarget.value); scheduleCommit() }} onKeyDown={event => { if (event.key === 'Enter') commit() }} />
    }
    return <TextInput {...common} maxLength={props.setting.maxLength} minLength={props.setting.minLength} placeholder={props.setting.placeholder} required={props.setting.required} value={String(draft)} onBlur={commit} onChange={event => { setDraft(event.currentTarget.value); scheduleCommit() }} onKeyDown={event => { if (event.key === 'Enter') commit() }} />
  }

  return (
    <Field id={inputId} label={props.setting.label} description={props.setting.description} error={error}>
      {controlProps => <>{renderControl(controlProps)}{status ? <small className={styles.status}>{status}</small> : null}</>}
    </Field>
  )
}

function commitSoon(commit: () => void): void {
  queueMicrotask(commit)
}

function toDraft(setting: ExtensionSettingContribution, value: JsonValue): boolean | string {
  if (setting.type === 'boolean') return typeof value === 'boolean' ? value : setting.default
  if (setting.type === 'number' || setting.type === 'range') return String(typeof value === 'number' ? value : setting.default)
  return typeof value === 'string' ? value : setting.default
}

function parseSettingValue(
  setting: ExtensionSettingContribution,
  draft: boolean | string,
  t: Translator,
): { ok: true; value: JsonValue } | { ok: false; error: string } {
  if (setting.type === 'boolean') return typeof draft === 'boolean' ? { ok: true, value: draft } : { ok: false, error: t('renderer.settingInvalid') }
  if (setting.type === 'number' || setting.type === 'range') {
    const value = Number(draft)
    if (!Number.isFinite(value)) return { ok: false, error: t('renderer.settingInvalidNumber') }
    if (setting.min !== undefined && value < setting.min) return { ok: false, error: t('renderer.settingBelowMinimum') }
    if (setting.max !== undefined && value > setting.max) return { ok: false, error: t('renderer.settingAboveMaximum') }
    return { ok: true, value }
  }
  const value = String(draft)
  if ((setting.type === 'text' || setting.type === 'multiline') && setting.required && !value.trim()) return { ok: false, error: t('renderer.settingRequired') }
  if ((setting.type === 'text' || setting.type === 'multiline') && setting.minLength !== undefined && value.length < setting.minLength) return { ok: false, error: t('renderer.settingTooShort') }
  if ((setting.type === 'text' || setting.type === 'multiline') && setting.maxLength !== undefined && value.length > setting.maxLength) return { ok: false, error: t('renderer.settingTooLong') }
  if (setting.type === 'select' && !setting.options.some(option => option.value === value)) return { ok: false, error: t('renderer.settingInvalid') }
  return { ok: true, value }
}

function sameDraftValue(setting: ExtensionSettingContribution, draft: boolean | string, value: JsonValue): boolean {
  return toDraft(setting, value) === draft
}

function resolveSettingScope(
  setting: ExtensionSettingContribution,
  context: { cardId?: string; timelineId?: string; agentSessionId?: string },
): ExtensionStorageScope | undefined {
  const scope = setting.scope ?? 'global'
  if (scope === 'global') return { kind: 'global' }
  if (scope === 'card') return context.cardId ? { kind: 'card', cardId: context.cardId } : undefined
  if (scope === 'timeline') return context.timelineId ? { kind: 'timeline', timelineId: context.timelineId } : undefined
  return context.agentSessionId ? { kind: 'agent-session', agentSessionId: context.agentSessionId } : undefined
}

function uniqueScopes(scopes: ExtensionStorageScope[]): ExtensionStorageScope[] {
  return [...new Map(scopes.map(scope => [JSON.stringify(scope), scope])).values()]
}

function configKey(scope: ExtensionStorageScope, key: string): string {
  return `${JSON.stringify(scope)}:${key}`
}

function groupSettings(items: Array<{ setting: ExtensionSettingContribution; scope?: ExtensionStorageScope }>) {
  const groups = new Map<string, typeof items>()
  for (const item of items) {
    const name = item.setting.group ?? ''
    const group = groups.get(name) ?? []
    group.push(item)
    groups.set(name, group)
  }
  return [...groups.entries()].map(([name, groupItems]) => ({ name, label: name || undefined, items: groupItems }))
}
