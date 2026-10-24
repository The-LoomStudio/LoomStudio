import { isSharedAppearanceParameter, readSharedAppearanceParameter } from '../model/appearance-parameters.js'
import { useAppearanceStore } from '../../../shared/studio-shell/appearance-store.js'
import { useStudioLayoutStore } from '../../../shared/studio-shell/studio-layout-store.js'
import { useEffect, useState } from 'react'
import { Button } from '@loom-studio/ui'
import type { StyleParameterValue } from '@loom-studio/extension-sdk'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ThemeController } from '../model/theme-controller.js'
import type { ThemeEntry } from '../model/theme-catalog.js'
import { defaultThemeSelection, useThemeStore } from '../model/theme-store.js'
import styles from './theme-settings.module.scss'

export function ThemeSettings({ controller, t }: { controller: ThemeController; t: Translator }) {
  const [draft, updateDraft] = useState(controller.selection)
  useEffect(() => { updateDraft(controller.selection) }, [controller.selection])
  const setDraft = (selection: typeof draft) => {
    updateDraft(selection)
    void controller.apply(selection)
  }
  const [localError, setLocalError] = useState<string>()
  useAppearanceStore(state => state.explicitOverrides)
  useAppearanceStore(state => state.material)
  useAppearanceStore(state => state.canvasWidth)
  useStudioLayoutStore(state => state.uiScale)
  useStudioLayoutStore(state => state.uiScaleOverridden)
  const overrides = useThemeStore(state => state.overrides)
  const themes = controller.entries.filter(entry => entry.kind === 'theme')
  const enhancements = controller.entries.filter(entry => entry.kind === 'enhancement')
  const ordered = [...enhancements].sort((a, b) => {
    const aIndex = draft.enhancements.indexOf(a.key)
    const bIndex = draft.enhancements.indexOf(b.key)
    return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex)
  })
  const active = controller.entries.filter(entry => entry.key === controller.selection.theme || controller.selection.enhancements.includes(entry.key))
  const selectedTheme = themes.find(entry => entry.key === draft.theme)

  async function run(action: () => Promise<void>) {
    setLocalError(undefined)
    try { await action() } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
  }
  function move(key: string, direction: number) {
    const next = [...draft.enhancements]
    const index = next.indexOf(key)
    const other = index + direction
    if (index < 0 || other < 0 || other >= next.length) return
    const moved = next[index]!
    next[index] = next[other]!
    next[other] = moved
    setDraft({ ...draft, enhancements: next })
  }
  function scriptControls(entry: ThemeEntry) {
    if (!entry.definition.moduleId) return null
    return <div className={styles.actions}>
      <Button type="button" aria-label={`${t(entry.module?.desired.enabled ? 'settings.themeJsAuthorized' : 'settings.themeAuthorizeJs')}: ${entry.definition.label}`} disabled={controller.busy || !entry.available || entry.module?.desired.enabled}
        onClick={() => { void run(() => controller.authorize(entry)) }}>
        {t(entry.module?.desired.enabled ? 'settings.themeJsAuthorized' : 'settings.themeAuthorizeJs')}
      </Button>
      {entry.definition.supportsCssOnly ? <label className={styles.checkbox}>
        <input type="checkbox" disabled={controller.busy} checked={draft.cssOnly.includes(entry.key)} onChange={event => {
          setDraft({ ...draft, cssOnly: event.target.checked ? [...draft.cssOnly, entry.key] : draft.cssOnly.filter(key => key !== entry.key) })
        }} />{t('settings.themeCssOnly')}
      </label> : null}
    </div>
  }

  return <section className={styles.section} aria-busy={controller.busy}>
    <h4>{t('settings.themes')}</h4>
    <label className={styles.field}>
      <span>{t('settings.themeMain')}</span>
      <select disabled={controller.busy} value={draft.theme ?? ''} onChange={event => setDraft({ ...draft, theme: event.target.value || null })}>
        <option value="">{t('settings.themeDefault')}</option>
        {draft.theme && !selectedTheme ? <option value={draft.theme} disabled>{t('settings.themeUnavailable')}</option> : null}
        {themes.map(entry => <option key={entry.key} value={entry.key} disabled={!entry.available}>{entry.definition.label} · {entry.packageLabel}</option>)}
      </select>
    </label>
    {selectedTheme ? <div className={styles.entry}>
      {selectedTheme.definition.description ? <p>{selectedTheme.definition.description}</p> : null}
      {scriptControls(selectedTheme)}
      {draft.theme !== controller.selection.theme ? <Button type="button" disabled={controller.busy} onClick={() => setDraft(draft)}>{t('settings.themeApply')}</Button> : null}
    </div> : null}
    <h4>{t('settings.themeEnhancements')}</h4>
    {!ordered.length ? <p>{t('settings.themeEnhancementsEmpty')}</p> : null}
    {ordered.map(entry => {
      const index = draft.enhancements.indexOf(entry.key)
      return <div key={entry.key} className={styles.entry}>
        <label className={styles.checkbox}>
          <input type="checkbox" disabled={controller.busy || (!entry.available && index < 0)} checked={index >= 0} onChange={event => {
            setDraft({ ...draft, enhancements: event.target.checked ? [...draft.enhancements, entry.key] : draft.enhancements.filter(key => key !== entry.key) })
          }} />{entry.definition.label} · {entry.packageLabel}
        </label>
        {entry.definition.description ? <p>{entry.definition.description}</p> : null}
        {index >= 0 ? <div className={styles.actions}>
          <Button type="button" disabled={controller.busy || index === 0} aria-label={`${t('settings.themeMoveUp')}: ${entry.definition.label}`} onClick={() => move(entry.key, -1)}>{t('settings.themeMoveUp')}</Button>
          <Button type="button" disabled={controller.busy || index === draft.enhancements.length - 1} aria-label={`${t('settings.themeMoveDown')}: ${entry.definition.label}`} onClick={() => move(entry.key, 1)}>{t('settings.themeMoveDown')}</Button>
        </div> : null}
        {scriptControls(entry)}
      </div>
    })}
    {controller.busy ? <p role="status">{t('settings.themeApplying')}</p> : null}
    {(localError || controller.error) ? <p role="alert">{localError || controller.error}</p> : null}
    {active.filter(entry => entry.definition.parameters?.length).map(entry => <fieldset key={entry.key} className={styles.parameters} disabled={controller.busy}>
      <legend>{entry.definition.label} · {t('settings.themeParameters')}</legend>
      {entry.definition.parameters?.map(parameter => {
        const shared = isSharedAppearanceParameter(parameter.variable)
        const sharedValue = readSharedAppearanceParameter(parameter.variable)
        const value = sharedValue ?? overrides[entry.key]?.[parameter.id] ?? parameter.default
        const overridden = shared ? sharedValue !== undefined : overrides[entry.key]?.[parameter.id] !== undefined
        const update = (next: StyleParameterValue | undefined) => { void run(() => controller.setParameter(entry, parameter.id, next)) }
        return <div key={parameter.id} className={styles.parameter}>
          <label className={styles.field}>
            <span>{parameter.label}</span>
            {parameter.type === 'number' ? <input key={String(value)} type="number" min={parameter.min} max={parameter.max} step={parameter.step ?? 'any'} defaultValue={Number(value)} onBlur={event => {
              const next = event.currentTarget.valueAsNumber
              if (Number.isFinite(next) && next !== value) update(next)
            }} /> : parameter.type === 'boolean' ? <input type="checkbox" checked={Boolean(value)} onChange={event => update(event.target.checked)} />
              : parameter.type === 'select' ? <select value={String(value)} onChange={event => update(event.target.value)}>{parameter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                : <input key={String(value)} type="text" spellCheck={false} defaultValue={String(value)} onBlur={event => { if (event.target.value !== String(value)) update(event.target.value) }} />}
          </label>
          <Button type="button" disabled={!overridden} aria-label={`${t('settings.themeRestoreParameter')}: ${parameter.label}`} onClick={() => update(undefined)}>{t('settings.themeRestoreParameter')}</Button>
        </div>
      })}
    </fieldset>)}
    <Button type="button" onClick={() => { setLocalError(undefined); updateDraft(defaultThemeSelection); controller.reset() }}>{t('settings.themeReset')}</Button>
    <p>{t('settings.themeRecoveryHint')}</p>
  </section>
}
