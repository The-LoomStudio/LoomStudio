import { AboutLinks } from './about-links.js'
import studioLogoUrl from '../../shared/assets/logo.png'
import { useWorkbenchView } from '../../shared/studio-shell/use-workbench-view.js'
import type { UserBackgroundLibrary } from '../../features/backgrounds/model/use-user-backgrounds.js'
import { useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { ThemeSettings } from '../../features/themes/ui/theme-settings.js'
import type { ThemeController } from '../../features/themes/model/theme-controller.js'
import { useEffect, useState, type FormEvent } from 'react'
import { Columns3, Globe, Info, Layers, Network, Palette, Save, ZoomIn } from 'lucide-react'
import { Button, Slider } from '@loom-studio/ui'
import type { NetworkSettings } from '../../shared/api/studio-api.js'
import type { Locale, Translator } from '../../shared/i18n/index.js'
import { localeLabels, supportedLocales } from '../../shared/i18n/index.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { useMotionPreferenceStore, type MotionPreference } from '../../shared/hooks/use-motion-preference.js'
import { useAppearanceStore } from '../../shared/studio-shell/appearance-store.js'
import { useTokenDisplaySettings } from '../../shared/tokenizer/settings.js'
import { BackgroundMaterialsView, type BackgroundOption } from './background-materials-view.js'
import styles from './settings-panel.module.scss'

type SettingsCategory = 'general' | 'network' | 'appearance' | 'about'

export function resolveNetworkSettingsPayload(
  proxyMode: NetworkSettings['proxyMode'],
  proxyUrl?: string,
): { proxyMode: NetworkSettings['proxyMode']; proxyUrl?: string } {
  return {
    proxyMode,
    ...(proxyMode === 'manual' ? { proxyUrl } : {}),
  }
}

export function SettingsPanel(props: {
  backgroundLibrary?: UserBackgroundLibrary
  requestedCategory?: SettingsCategory
  previewBackgroundId?: string
  themeController?: ThemeController
  busy: boolean
  customCss: string
  locale: Locale
  localePending?: boolean
  networkSettings: NetworkSettings
  backgrounds?: readonly BackgroundOption[]
  backgroundCardId?: string
  uiScale: number
  onChangeCustomCss(value: string): void
  onChangeLocale(locale: Locale): void
  onChangeUiScale(value: number): void
  onUpdateNetworkSettings(value: { proxyMode: NetworkSettings['proxyMode']; proxyUrl?: string }): Promise<void>
  t: Translator
}) {
  const [category, setCategory] = useWorkbenchView<SettingsCategory>('settings.category', 'general', ['general', 'network', 'appearance', 'about'])
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  useEffect(() => {
    if (props.requestedCategory) { setCategory(props.requestedCategory); setMobilePane('detail') }
  }, [props.requestedCategory, props.previewBackgroundId])
  const [networkError, setNetworkError] = useState<string>()
  const [proxyMode, setProxyMode] = useState(props.networkSettings.proxyMode)
  const [proxyUrl, setProxyUrl] = useState(props.networkSettings.proxyUrl ?? '')
  const tokenMultiplier = useTokenDisplaySettings(state => state.multiplier)
  const setTokenMultiplier = useTokenDisplaySettings(state => state.setMultiplier)
  const previewBackgroundId = useAppearanceStore(state => state.scopedBackground && state.scopedBackground.cardId === props.backgroundCardId
    ? state.scopedBackground.id : state.background?.id ?? null)
  const focusComposerOnStartup = useAppearanceStore(state => state.focusComposerOnStartup)
  const setFocusComposerOnStartup = useAppearanceStore(state => state.setFocusComposerOnStartup)
  const previewFollowState = useAppearanceStore(state => state.followAI)
  const explicitOverrides = useAppearanceStore(state => state.explicitOverrides)
  const resetCanvasWidth = useAppearanceStore(state => state.resetCanvasWidth)
  const resetMaterial = useAppearanceStore(state => state.resetMaterial)
  const uiScaleOverridden = useStudioLayoutStore(state => state.uiScaleOverridden)
  const resetUiScale = useStudioLayoutStore(state => state.resetUiScale)
  const previewMaterial = useAppearanceStore(state => state.material)
  const previewCanvasWidth = useAppearanceStore(state => state.canvasWidth ?? 720)
  const setPreviewBackground = useAppearanceStore(state => state.setBackground)
  const setScopedBackground = useAppearanceStore(state => state.setScopedBackground)
  const setPreviewFollowState = useAppearanceStore(state => state.setFollowAI)
  const setMaterialParameter = useAppearanceStore(state => state.setMaterialParameter)
  const setPreviewMaterial = useAppearanceStore(state => state.setMaterial)
  const setPreviewCanvasWidth = useAppearanceStore(state => state.setCanvasWidth)
  const narrativeOverscan = useAppearanceStore(state => state.narrativeOverscan)
  const setNarrativeOverscan = useAppearanceStore(state => state.setNarrativeOverscan)
  const motionPreference = useMotionPreferenceStore(state => state.preference)
  const setMotionPreference = useMotionPreferenceStore(state => state.setPreference)
  const [computedAppearance, setComputedAppearance] = useState({ uiScale: props.uiScale, canvasWidth: previewCanvasWidth, blur: previewMaterial.blur, opacity: previewMaterial.opacity })
  useEffect(() => {
    let frame = 0
    const refresh = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const css = getComputedStyle(document.documentElement)
        const read = (name: string, fallback: number) => {
          const value = Number.parseFloat(css.getPropertyValue(name))
          return Number.isFinite(value) ? value : fallback
        }
        setComputedAppearance({
          uiScale: read('--loom-ui-scale', props.uiScale / 100) * 100,
          canvasWidth: read('--loom-canvas-width', previewCanvasWidth),
          blur: read('--loom-preview-blur', previewMaterial.blur),
          opacity: read('--loom-preview-opacity', previewMaterial.opacity),
        })
      })
    }
    refresh()
    document.addEventListener('loom:theme-changed', refresh)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('loom:theme-changed', refresh) }
  }, [category, explicitOverrides, previewMaterial, previewCanvasWidth, props.uiScale, uiScaleOverridden, props.customCss])
  const effectiveMaterial = {
    ...previewMaterial,
    blur: explicitOverrides.blur ? previewMaterial.blur : computedAppearance.blur,
    opacity: explicitOverrides.opacity ? previewMaterial.opacity : computedAppearance.opacity,
  }
  const backgrounds = props.backgrounds ?? []
  const categories = [
    { id: 'general', label: props.t('settings.general'), icon: Globe },
    { id: 'network', label: props.t('settings.network'), icon: Network },
    { id: 'appearance', label: props.t('settings.appearance'), icon: Palette },
    { id: 'about', label: props.t('settings.about'), icon: Info },
  ] as const

  useEffect(() => {
    setProxyMode(props.networkSettings.proxyMode)
    setProxyUrl(props.networkSettings.proxyUrl ?? '')
  }, [props.networkSettings.proxyMode, props.networkSettings.proxyUrl])

  async function saveNetworkSettings(event: FormEvent) {
    event.preventDefault()
    setNetworkError(undefined)
    try {
      await props.onUpdateNetworkSettings(resolveNetworkSettingsPayload(proxyMode, proxyUrl))
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className={styles.settingsPanel} data-loom-component="settings-panel">
      <MasterDetailWorkbench
        navigationScope="local"
        className={styles.workbench}
        defaultMasterWidth={200}
        masterMinWidth={160}
        backLabel={props.t('settings.back')}
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={(
          <nav aria-label={props.t('settings.categories')} className={styles.masterNav}>
            {categories.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={category === id ? 'page' : undefined}
                className={styles.navItem}
                type="button"
                onClick={() => { setCategory(id); setMobilePane('detail') }}
              >
                <Icon aria-hidden="true" size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}
      >
        <div className={styles.detailPane}>
          <header className={styles.detailHeader}>
            <h3>{categories.find(item => item.id === category)?.label}</h3>
          </header>
          {category === 'general' ? (
            <>
              <section className={styles.settingSection}>
                <label className={styles.settingRow}>
                  <span>{props.t('app.localeLabel')}</span>
                  <select value={props.locale} disabled={props.localePending} aria-busy={props.localePending} onChange={event => props.onChangeLocale(event.target.value as Locale)}>
                    {supportedLocales.map(locale => <option key={locale} value={locale}>{localeLabels[locale]}</option>)}
                  </select>
                </label>
              </section>
              <section className={styles.settingSection}>
                <label className={styles.settingRow}>
                  <span>{props.t('settings.focusComposerOnStartup')}</span>
                  <input type="checkbox" checked={focusComposerOnStartup} onChange={event => setFocusComposerOnStartup(event.currentTarget.checked)} />
                </label>
                <p>{props.t('settings.focusComposerOnStartupHelp')}</p>
              </section>
              <section className={styles.settingSection}>
                <label className={styles.settingRow} title={props.t('tokens.displayMultiplierHelp')}>
                  <span>{props.t('tokens.displayMultiplier')}</span>
                  <input aria-label={props.t('tokens.displayMultiplier')} type="number" min="0.01" step="0.05"
                    value={tokenMultiplier} onChange={event => {
                      const value = event.currentTarget.valueAsNumber
                      if (Number.isFinite(value) && value > 0) setTokenMultiplier(value)
                    }} />
                </label>
              </section>
            </>
          ) : category === 'network' ? (
            <form className={styles.settingSection} onSubmit={event => { void saveNetworkSettings(event) }}>
              <label className={styles.settingRow}>
                <span>{props.t('settings.proxyMode')}</span>
                <select disabled={props.busy} value={proxyMode}
                  onChange={event => setProxyMode(event.target.value as NetworkSettings['proxyMode'])}>
                  <option value="system">{props.t('settings.proxyModeSystem')}</option>
                  <option value="direct">{props.t('settings.proxyModeDirect')}</option>
                  <option value="manual">{props.t('settings.proxyModeManual')}</option>
                </select>
              </label>
              {proxyMode === 'manual' ? (
                <label className={styles.settingRow}>
                  <span>{props.t('settings.proxyUrl')}</span>
                  <input disabled={props.busy} required placeholder="http://127.0.0.1:7890"
                    value={proxyUrl} onChange={event => setProxyUrl(event.target.value)} />
                </label>
              ) : null}
              {networkError ? <p role="alert">{networkError}</p> : null}
              <p className={styles.networkStatus}>
                {props.networkSettings.systemProxyDetected ? props.t('settings.systemProxyDetected') : props.t('settings.systemProxyNotDetected')}
              </p>
              <Button disabled={props.busy || (proxyMode === 'manual' && !proxyUrl.trim())} type="submit">
                <Save aria-hidden="true" size={16} />{props.t('settings.saveNetwork')}
              </Button>
            </form>
          ) : category === 'appearance' ? (
            <BackgroundMaterialsView
              previewBackgroundId={props.previewBackgroundId}
              library={props.backgroundLibrary}
              t={props.t}
              backgrounds={backgrounds}
              followState={previewFollowState}
              material={effectiveMaterial}
              selectedId={previewBackgroundId}
              general={(
                <div className={styles.generalSettings}>
                  {props.themeController ? <ThemeSettings controller={props.themeController} t={props.t} /> : null}
                  <section className={styles.settingSection}>
                    <Slider
                      icon={<ZoomIn size={14} />}
                      label={props.t('settings.uiScale')}
                      min={80}
                      max={125}
                      step={5}
                      value={uiScaleOverridden ? props.uiScale : computedAppearance.uiScale}
                      formatValue={v => `${v}%`}
                      onValueChange={val => props.onChangeUiScale(val)}
                    />
                    <Button type="button" disabled={!uiScaleOverridden} onClick={resetUiScale}>{props.t('settings.themeRestoreParameter')}</Button>
                  </section>
                  <section className={styles.settingSection}>
                    <Slider
                      icon={<Columns3 size={14} />}
                      label={props.t('settings.canvasWidth')}
                      min={540}
                      max={1120}
                      step={20}
                      value={explicitOverrides.canvasWidth ? previewCanvasWidth : computedAppearance.canvasWidth}
                      formatValue={v => `${v}px`}
                      onValueChange={val => setPreviewCanvasWidth(val)}
                    />
                    <Button type="button" disabled={!explicitOverrides.canvasWidth} onClick={resetCanvasWidth}>{props.t('settings.themeRestoreParameter')}</Button>
                  </section>
                  <section className={styles.settingSection}>
                    <Button type="button" onClick={resetMaterial}>{props.t('settings.themeRestoreParameter')} · {props.t('appearance.surfaceMode')}</Button>
                  </section>
                  <section className={styles.settingSection}>
                    <Slider
                      icon={<Layers size={14} />}
                      label={props.t('settings.narrativeOverscan')}
                      min={0}
                      max={50}
                      step={1}
                      value={narrativeOverscan}
                      formatValue={v => `${v}`}
                      onValueChange={val => setNarrativeOverscan(val)}
                    />
                  </section>
                  <section className={styles.settingSection}>
                    <label className={styles.settingRow}>
                      <span>{props.t('settings.motion')}</span>
                      <select value={motionPreference} onChange={event => setMotionPreference(event.target.value as MotionPreference)}>
                        <option value="system">{props.t('settings.motionSystem')}</option>
                        <option value="full">{props.t('settings.motionFull')}</option>
                        <option value="reduce">{props.t('settings.motionReduce')}</option>
                      </select>
                    </label>
                  </section>
                  <section className={styles.settingSection}>
                    <label className={styles.settingRow}>
                      <span>{props.t('settings.customCss')}</span>
                      <textarea className={styles.customCssTextarea} placeholder={props.t('settings.customCssPlaceholder')}
                        spellCheck={false} value={props.customCss} onChange={event => props.onChangeCustomCss(event.target.value)} />
                    </label>
                  </section>
                </div>
              )}
              onFollowStateChange={setPreviewFollowState}
              onMaterialChange={material => {
                setPreviewMaterial({ ...material, blur: previewMaterial.blur, opacity: previewMaterial.opacity })
                if (material.blur !== effectiveMaterial.blur) setMaterialParameter('blur', material.blur)
                if (material.opacity !== effectiveMaterial.opacity) setMaterialParameter('opacity', material.opacity)
              }}
              onSelect={id => {
                const background = backgrounds.find(item => item.id === id)
                if (background?.scope) {
                  setScopedBackground({ id: background.id, image: background.image, ...background.scope })
                } else {
                  setPreviewBackground(background ?? null)
                }
              }}
            />
          ) : (
            <section className={styles.settingSection}>
              <div className={styles.aboutBrand}>
                <img src={studioLogoUrl} alt="" width={64} height={64} />
                <div><h4>Loom Studio</h4><span>v{STUDIO_VERSION}</span></div>
              </div>
              <AboutLinks locale={props.locale} t={props.t} />
            </section>
          )}
        </div>
      </MasterDetailWorkbench>
    </section>
  )
}

declare const __LOOM_STUDIO_VERSION__: string

const STUDIO_VERSION = typeof __LOOM_STUDIO_VERSION__ === 'string' ? __LOOM_STUDIO_VERSION__ : '0.0.0-developer-preview'
