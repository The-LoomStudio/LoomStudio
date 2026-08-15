import { useEffect, useState, type FormEvent } from 'react'
import type { NetworkSettings } from '../../shared/api/studio-api.js'
import type { Locale, Translator } from '../../shared/i18n/index.js'
import { localeLabels, supportedLocales } from '../../shared/i18n/index.js'
import styles from './settings-panel.module.scss'

export function SettingsPanel(props: {
  busy: boolean
  customCss: string
  locale: Locale
  networkSettings: NetworkSettings
  uiScale: number
  onChangeCustomCss(value: string): void
  onChangeLocale(locale: Locale): void
  onChangeUiScale(value: number): void
  onUpdateNetworkSettings(value: { proxyMode: NetworkSettings['proxyMode']; proxyUrl?: string }): void
  t: Translator
}) {
  const [proxyMode, setProxyMode] = useState(props.networkSettings.proxyMode)
  const [proxyUrl, setProxyUrl] = useState(props.networkSettings.proxyUrl ?? '')

  useEffect(() => {
    setProxyMode(props.networkSettings.proxyMode)
    setProxyUrl(props.networkSettings.proxyUrl ?? '')
  }, [props.networkSettings.proxyMode, props.networkSettings.proxyUrl])

  function saveNetworkSettings(event: FormEvent) {
    event.preventDefault()
    props.onUpdateNetworkSettings({
      proxyMode,
      ...(proxyMode === 'manual' ? { proxyUrl } : {}),
    })
  }

  return (
    <section className={styles.settingsPanel} data-loom-component="settings-panel">
      <h2>{props.t('settings.general')}</h2>
      <label className={styles.settingRow}>
        <span>{props.t('app.localeLabel')}</span>
        <select value={props.locale} onChange={event => props.onChangeLocale(event.target.value as Locale)}>
          {supportedLocales.map(locale => <option key={locale} value={locale}>{localeLabels[locale]}</option>)}
        </select>
      </label>
      <h2 className={styles.sectionHeading}>{props.t('settings.network')}</h2>
      <form className={styles.networkSettings} onSubmit={saveNetworkSettings}>
        <label className={styles.settingRow}>
          <span>{props.t('settings.proxyMode')}</span>
          <select value={proxyMode} onChange={event => setProxyMode(event.target.value as NetworkSettings['proxyMode'])}>
            <option value="system">{props.t('settings.proxyModeSystem')}</option>
            <option value="direct">{props.t('settings.proxyModeDirect')}</option>
            <option value="manual">{props.t('settings.proxyModeManual')}</option>
          </select>
        </label>
        {proxyMode === 'manual' ? (
          <label className={styles.settingRow}>
            <span>{props.t('settings.proxyUrl')}</span>
            <input required placeholder="http://127.0.0.1:7890" value={proxyUrl} onChange={event => setProxyUrl(event.target.value)} />
          </label>
        ) : null}
        <p className={styles.networkStatus}>
          {props.networkSettings.systemProxyDetected
            ? props.t('settings.systemProxyDetected')
            : props.t('settings.systemProxyNotDetected')}
        </p>
        <button disabled={props.busy || (proxyMode === 'manual' && !proxyUrl.trim())} type="submit">{props.t('settings.saveNetwork')}</button>
      </form>
      <h2>{props.t('settings.appearance')}</h2>
      <label className={styles.scaleRow}>
        <span>{props.t('settings.uiScale')}</span>
        <input
          aria-label={props.t('settings.uiScale')}
          max="125"
          min="80"
          step="5"
          type="range"
          value={props.uiScale}
          onChange={event => props.onChangeUiScale(Number(event.target.value))}
        />
        <output>{props.uiScale}%</output>
      </label>
      <label className={styles.customCss}>
        <span>{props.t('settings.customCss')}</span>
        <textarea placeholder={props.t('settings.customCssPlaceholder')} spellCheck={false} value={props.customCss} onChange={event => props.onChangeCustomCss(event.target.value)} />
      </label>
    </section>
  )
}
