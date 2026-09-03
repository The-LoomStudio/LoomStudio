import { useEffect, useState, type FormEvent } from 'react'
import { Globe, Info, Network, Palette } from 'lucide-react'
import type { NetworkSettings } from '../../shared/api/studio-api.js'
import type { Locale, Translator } from '../../shared/i18n/index.js'
import { localeLabels, supportedLocales } from '../../shared/i18n/index.js'
import styles from './settings-panel.module.scss'

type SettingsCategory = 'general' | 'network' | 'appearance' | 'about'

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
  const [category, setCategory] = useState<SettingsCategory>('general')
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
      <header className={styles.intro}>
        <div>
          <h2>系统设置 (Settings)</h2>
          <p>定制 Loom Studio 客户端环境、代理与外观表现。</p>
        </div>
      </header>

      <div className={styles.workbench}>
        <nav aria-label="Settings Navigation" className={styles.masterNav}>
          <button
            aria-current={category === 'general' ? 'page' : undefined}
            className={styles.navItem}
            type="button"
            onClick={() => setCategory('general')}
          >
            <Globe aria-hidden="true" />
            <span className={styles.navItemBody}>
              <strong>{props.t('settings.general')}</strong>
              <small>语言与区域</small>
            </span>
          </button>

          <button
            aria-current={category === 'network' ? 'page' : undefined}
            className={styles.navItem}
            type="button"
            onClick={() => setCategory('network')}
          >
            <Network aria-hidden="true" />
            <span className={styles.navItemBody}>
              <strong>{props.t('settings.network')}</strong>
              <small>代理与网络连接</small>
            </span>
          </button>

          <button
            aria-current={category === 'appearance' ? 'page' : undefined}
            className={styles.navItem}
            type="button"
            onClick={() => setCategory('appearance')}
          >
            <Palette aria-hidden="true" />
            <span className={styles.navItemBody}>
              <strong>{props.t('settings.appearance')}</strong>
              <small>UI 缩放与自定义 CSS</small>
            </span>
          </button>

          <button
            aria-current={category === 'about' ? 'page' : undefined}
            className={styles.navItem}
            type="button"
            onClick={() => setCategory('about')}
          >
            <Info aria-hidden="true" />
            <span className={styles.navItemBody}>
              <strong>系统与关于</strong>
              <small>运行时信息与状态</small>
            </span>
          </button>
        </nav>

        <div className={styles.detailPane}>
          {category === 'general' ? (
            <>
              <header className={styles.detailHeader}>
                <h3>{props.t('settings.general')}</h3>
              </header>
              <div className={styles.cardSection}>
                <h4>语言选择</h4>
                <p>切换 Loom Studio 的界面显示语言。</p>
                <label className={styles.settingRow}>
                  <span>{props.t('app.localeLabel')}</span>
                  <select
                    value={props.locale}
                    onChange={event => props.onChangeLocale(event.target.value as Locale)}
                  >
                    {supportedLocales.map(locale => (
                      <option key={locale} value={locale}>{localeLabels[locale]}</option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : category === 'network' ? (
            <>
              <header className={styles.detailHeader}>
                <h3>{props.t('settings.network')}</h3>
              </header>
              <form className={styles.cardSection} onSubmit={saveNetworkSettings}>
                <h4>代理与网络模式</h4>
                <p>配置用于 AI Gateway 和扩展通信的网络出口。</p>

                <label className={styles.settingRow}>
                  <span>{props.t('settings.proxyMode')}</span>
                  <select
                    value={proxyMode}
                    onChange={event => setProxyMode(event.target.value as NetworkSettings['proxyMode'])}
                  >
                    <option value="system">{props.t('settings.proxyModeSystem')}</option>
                    <option value="direct">{props.t('settings.proxyModeDirect')}</option>
                    <option value="manual">{props.t('settings.proxyModeManual')}</option>
                  </select>
                </label>

                {proxyMode === 'manual' ? (
                  <label className={styles.settingRow}>
                    <span>{props.t('settings.proxyUrl')}</span>
                    <input
                      required
                      placeholder="http://127.0.0.1:7890"
                      value={proxyUrl}
                      onChange={event => setProxyUrl(event.target.value)}
                    />
                  </label>
                ) : null}

                <p className={styles.networkStatus}>
                  {props.networkSettings.systemProxyDetected
                    ? props.t('settings.systemProxyDetected')
                    : props.t('settings.systemProxyNotDetected')}
                </p>

                <button
                  className={styles.primaryButton}
                  disabled={props.busy || (proxyMode === 'manual' && !proxyUrl.trim())}
                  type="submit"
                >
                  {props.t('settings.saveNetwork')}
                </button>
              </form>
            </>
          ) : category === 'appearance' ? (
            <>
              <header className={styles.detailHeader}>
                <h3>{props.t('settings.appearance')}</h3>
              </header>
              <div className={styles.cardSection}>
                <h4>界面缩放 (UI Scale)</h4>
                <p>调整客户端整体视觉比例大小。</p>
                <div className={styles.scaleRow}>
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
                </div>
              </div>

              <div className={styles.cardSection}>
                <h4>自定义 CSS (Custom Styles)</h4>
                <p>注入自定义样式规则以调整界面风格。</p>
                <textarea
                  className={styles.customCssTextarea}
                  placeholder={props.t('settings.customCssPlaceholder')}
                  spellCheck={false}
                  value={props.customCss}
                  onChange={event => props.onChangeCustomCss(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <header className={styles.detailHeader}>
                <h3>系统与关于 (About)</h3>
              </header>
              <div className={styles.cardSection}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <img src="/images/logo.png" alt="Loom Studio Logo" style={{ width: '38px', height: '38px', objectFit: 'contain' }} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px' }}>Loom Studio</h4>
                    <span style={{ fontSize: '11.5px', color: 'var(--loom-muted-foreground, #888)' }}>Weave worlds, interweave stories.</span>
                  </div>
                </div>
                <p>下一代 Agentic Narrative 沉浸式创作与工作台。</p>
                <div style={{ display: 'grid', gap: '10px', fontSize: '12.5px', marginTop: '10px' }}>
                  <div><strong>版本:</strong> v{STUDIO_VERSION}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong>开源代码仓:</strong>
                    <a
                      className={styles.aboutLink}
                      href="https://github.com/The-LoomStudio/LoomStudio.git"
                      rel="noreferrer"
                      target="_blank"
                    >
                      <GitHubMark />
                      <span>GitHub (The-LoomStudio/LoomStudio)</span>
                    </a>
                  </div>
                  <div><strong>架构:</strong> Next-Gen Agent Pipeline & Unified Master-Detail Engine</div>
                  <div><strong>数据状态:</strong> Local Native SQLite + Reactive State Sync</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

declare const __LOOM_STUDIO_VERSION__: string

const STUDIO_VERSION = typeof __LOOM_STUDIO_VERSION__ === 'string' ? __LOOM_STUDIO_VERSION__ : '0.0.0-developer-preview'

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.64 0 8c0 3.54 2.29 6.53 5.47 7.59.4.08.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.38-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82A7.65 7.65 0 0 1 8 3.87c.68 0 1.36.09 2 .27 1.53-1.05 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.05-1.87 3.74-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.38A8.01 8.01 0 0 0 16 8c0-4.36-3.58-8-8-8Z" />
    </svg>
  )
}

