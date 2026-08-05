import type { Locale, Translator } from '../../shared/i18n/index.js'
import { localeLabels, supportedLocales } from '../../shared/i18n/index.js'
import styles from './settings-panel.module.scss'

export function SettingsPanel(props: { customCss: string; locale: Locale; onChangeCustomCss(value: string): void; onChangeLocale(locale: Locale): void; t: Translator }) {
  return (
    <section className={styles.settingsPanel} data-loom-component="settings-panel">
      <h2>{props.t('settings.general')}</h2>
      <label className={styles.settingRow}>
        <span>{props.t('app.localeLabel')}</span>
        <select value={props.locale} onChange={event => props.onChangeLocale(event.target.value as Locale)}>
          {supportedLocales.map(locale => <option key={locale} value={locale}>{localeLabels[locale]}</option>)}
        </select>
      </label>
      <h2>{props.t('settings.appearance')}</h2>
      <label className={styles.customCss}>
        <span>{props.t('settings.customCss')}</span>
        <textarea placeholder={props.t('settings.customCssPlaceholder')} spellCheck={false} value={props.customCss} onChange={event => props.onChangeCustomCss(event.target.value)} />
      </label>
    </section>
  )
}
