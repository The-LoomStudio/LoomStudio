import { Button, Checkbox, Field, TextInput, Textarea, type FieldControlProps } from '@loom-studio/ui'
import type {
  ExtensionConfigEntry,
  ExtensionInstallationTarget,
  ExtensionSettingContribution,
  ExtensionStorageScope,
  JsonValue,
} from '@loom-studio/extension-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './extension-settings-form.module.scss'

const TEXT_COMMIT_DELAY_MS = 450

type ExtensionSettingsFormProps = {
  api: Pick<StudioApi['extensionRuntime'], 'getConfig' | 'listConfigs' | 'upsertConfig'>
  configRevision: number
  packageId: string
  target: ExtensionInstallationTarget
  scopeContext: { cardId?: string; timelineId?: string; timelineCardId?: string; agentSessionId?: string; agentSessionCardId?: string }
  settings: readonly ExtensionSettingContribution[]
  t: Translator
}

export function ExtensionSettingsForm(props: ExtensionSettingsFormProps) {
  const [source, setSource] = useState({ api: props.api, epoch: 0 })
  let epoch = source.epoch
  if (source.api !== props.api) {
    epoch++
    setSource({ api: props.api, epoch })
  }
  const identity = JSON.stringify([epoch, props.packageId, props.target, props.settings.map(setting => resolveSettingScope(setting, props.scopeContext, props.target))])
  return <ExtensionSettingsFields key={identity} {...props} />
}

function ExtensionSettingsFields(props: ExtensionSettingsFormProps) {
  const resolved = useMemo(() => props.settings
    .map(setting => ({ setting, scope: resolveSettingScope(setting, props.scopeContext, props.target) }))
    .sort((left, right) => (left.setting.suggestedOrder ?? 0) - (right.setting.suggestedOrder ?? 0)
      || left.setting.label.localeCompare(right.setting.label)), [props.scopeContext, props.settings, props.target])
  const [entries, setEntries] = useState<Record<string, ExtensionConfigEntry>>()
  const [loadError, setLoadError] = useState<string>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const mountedRef = useRef(false)
  const scopeSignature = JSON.stringify(resolved.flatMap(item => item.scope ? [item.scope] : []))

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let disposed = false
    setEntries(undefined)
    setLoadError(undefined)
    const scopes = uniqueScopes(resolved.flatMap(item => item.scope ? [item.scope] : []))
    void Promise.all(scopes.map(async scope => await props.api.listConfigs({ packageId: props.packageId, target: props.target, scope })))
      .then(results => {
        if (disposed) return
        setEntries(Object.fromEntries(results.flatMap(result => result.configs).map(entry => [configKey(entry.scope, entry.key), entry])))
        setLoadError(undefined)
      }, error => {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { disposed = true }
  }, [props.api, props.configRevision, props.packageId, scopeSignature, loadAttempt])

  const groups = groupSettings(resolved)
  return (
    <article className={styles.settings} data-loom-component="extension-settings-form">
      <header>
        <h3>{props.t('renderer.settings')}</h3>
      </header>
      {loadError ? <div role="alert">
        <p className={styles.loadError}>{loadError}</p>
        <Button type="button" onClick={() => setLoadAttempt(value => value + 1)}>{props.t('renderer.settingsRetry')}</Button>
      </div> : !entries ? <p role="status">{props.t('renderer.settingsLoading')}</p> : null}
      {groups.map(group => (
        <section className={styles.group} key={group.name}>
          {group.label ? <h4>{group.label}</h4> : null}
          {group.items.map(({ setting, scope }) => scope ? (
            <SettingField
              disabled={!entries || Boolean(loadError)}
              entry={entries?.[configKey(scope, setting.id)]}
              key={`${configKey(scope, setting.id)}:${setting.type}`}
              setting={setting}
              t={props.t}
              onCommit={async (value, expectedVersion) => {
                const result = await props.api.upsertConfig({
                  packageId: props.packageId, target: props.target, scope, key: setting.id, value,
                  ...(expectedVersion === undefined ? {} : { expectedVersion }),
                })
                if (mountedRef.current) setEntries(current => current ? { ...current, [configKey(scope, setting.id)]: result.config } : current)
                return result.config
              }}
              onLoadLatest={async () => (await props.api.getConfig({ packageId: props.packageId, target: props.target, scope, key: setting.id })).config}
              onUseLatest={entry => {
                setEntries(current => {
                  if (!current) return current
                  const next = { ...current }
                  if (entry) next[configKey(scope, setting.id)] = entry
                  else delete next[configKey(scope, setting.id)]
                  return next
                })
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
  disabled: boolean
  entry?: ExtensionConfigEntry
  setting: ExtensionSettingContribution
  t: Translator
  onCommit(value: JsonValue, expectedVersion?: number): Promise<ExtensionConfigEntry>
  onLoadLatest(): Promise<ExtensionConfigEntry | null>
  onUseLatest(entry: ExtensionConfigEntry | null): void
}) {
  const inputId = `extension-setting-${props.setting.id}`
  const [draft, setDraftState] = useState<boolean | string>(() => toDraft(props.setting, props.entry?.value ?? props.setting.default))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [recovery, setRecovery] = useState<{ loading: boolean; latest?: ExtensionConfigEntry | null; error?: string }>()
  const recoveryRef = useRef(false)
  const editableRef = useRef(false)
  editableRef.current = !props.disabled && !props.setting.readOnly
  const draftRef = useRef(draft)
  const dirtyRef = useRef(dirty)
  const versionRef = useRef(props.entry?.version)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queuedRef = useRef<JsonValue | undefined>(undefined)
  const hasQueuedRef = useRef(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (dirtyRef.current || savingRef.current || recoveryRef.current) return
    versionRef.current = props.entry?.version
    const nextDraft = toDraft(props.setting, props.entry?.value ?? props.setting.default)
    draftRef.current = nextDraft
    dirtyRef.current = false
    setDraftState(nextDraft)
    setDirty(false)
  }, [props.entry?.value, props.entry?.version, props.setting])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      hasQueuedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function setDraft(value: boolean | string): void {
    if (!dirtyRef.current && !savingRef.current) versionRef.current = props.entry?.version
    draftRef.current = value
    dirtyRef.current = true
    setDraftState(value)
    setDirty(true)
    if (!recoveryRef.current) setError(undefined)
  }

  async function loadLatest(): Promise<void> {
    setRecovery({ loading: true })
    try {
      const latest = await props.onLoadLatest()
      if (mountedRef.current) setRecovery({ loading: false, latest })
    } catch (reason) {
      if (mountedRef.current) setRecovery({ loading: false, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  function resolveFailure(useDraft: boolean): void {
    if (!editableRef.current || !recovery || recovery.loading || recovery.latest === undefined) return
    if (timerRef.current) clearTimeout(timerRef.current)
    hasQueuedRef.current = false
    versionRef.current = recovery.latest?.version
    props.onUseLatest(recovery.latest)
    recoveryRef.current = false
    setRecovery(undefined)
    setError(undefined)
    if (useDraft) commit()
    else {
      const value = toDraft(props.setting, recovery.latest?.value ?? props.setting.default)
      draftRef.current = value
      dirtyRef.current = false
      setDraftState(value)
      setDirty(false)
    }
  }

  async function drainQueue(): Promise<void> {
    if (savingRef.current || !mountedRef.current || recoveryRef.current || !editableRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      while (hasQueuedRef.current && mountedRef.current && !recoveryRef.current && editableRef.current) {
        const value = queuedRef.current!
        hasQueuedRef.current = false
        try {
          const entry = await props.onCommit(value, versionRef.current)
          if (!mountedRef.current) return
          versionRef.current = entry.version
          if (!hasQueuedRef.current && sameDraftValue(props.setting, draftRef.current, value)) {
            dirtyRef.current = false
            setDirty(false)
          }
          setError(undefined)
        } catch (reason) {
          hasQueuedRef.current = false
          if (!mountedRef.current) return
          recoveryRef.current = true
          if (timerRef.current) clearTimeout(timerRef.current)
          setError(reason instanceof Error ? reason.message : String(reason))
          await loadLatest()
        }
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  function commit(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!editableRef.current || recoveryRef.current || !mountedRef.current || !dirtyRef.current) return
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

  const status = saving ? props.t('renderer.settingSaving') : dirty && !error && !recovery ? props.t('renderer.settingUnsaved') : undefined
  function renderControl(fieldControlProps: FieldControlProps) {
    const common = {
      ...fieldControlProps,
      disabled: props.disabled || props.setting.readOnly,
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
      {controlProps => <>{renderControl(controlProps)}{status ? <small className={styles.status}>{status}</small> : null}
        {recovery && <div className={styles.recovery}>
          <p>{props.t('renderer.settingRecoveryNeeded')}</p>
          {recovery.loading ? <p role="status">{props.t('renderer.settingLatestLoading')}</p> : recovery.error ? <>
            <p role="alert">{recovery.error}</p>
            <Button type="button" disabled={props.disabled || props.setting.readOnly} onClick={() => void loadLatest()}>{props.t('renderer.settingLatestRetry')}</Button>
          </> : <>
            <Button type="button" disabled={props.disabled || props.setting.readOnly} onClick={() => resolveFailure(false)}>{props.t(recovery.latest ? 'renderer.settingUseServer' : 'renderer.settingUseDefault')}</Button>
            <Button type="button" disabled={props.disabled || props.setting.readOnly} onClick={() => resolveFailure(true)}>{props.t('renderer.settingReapplyDraft')}</Button>
          </>}
        </div>}
      </>}
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
  context: { cardId?: string; timelineId?: string; timelineCardId?: string; agentSessionId?: string; agentSessionCardId?: string },
  target: ExtensionInstallationTarget,
): ExtensionStorageScope | undefined {
  const scope = setting.scope ?? 'global'
  if (scope === 'global') return target.kind === 'global' ? { kind: 'global' } : undefined
  if (scope === 'card') return context.cardId && (target.kind === 'global' || target.cardId === context.cardId) ? { kind: 'card', cardId: context.cardId } : undefined
  if (scope === 'timeline') return context.timelineId && (target.kind === 'global' || context.timelineCardId === target.cardId) ? { kind: 'timeline', timelineId: context.timelineId } : undefined
  if (scope === 'agent-session') return context.agentSessionId && (target.kind === 'global' || context.agentSessionCardId === target.cardId) ? { kind: 'agent-session', agentSessionId: context.agentSessionId } : undefined
  return undefined
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
