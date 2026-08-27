import { Blocks } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import type { StudioPanelId } from './model/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from './model/studio-panel-presentation.js'
import styles from './studio-page.module.scss'

declare const __LOOM_STUDIO_VERSION__: string

const STUDIO_VERSION = typeof __LOOM_STUDIO_VERSION__ === 'string' ? __LOOM_STUDIO_VERSION__ : 'dev'

type StudioRailProps = {
  activePanel: StudioPanelId | null
  modelConfigured?: boolean
  t: Translator
  togglePanel(panel: StudioPanelId): void
}

type RailTabProps = {
  activePanel: StudioPanelId | null
  label?: string
  panel: StudioPanelId
  status?: 'configured' | 'incomplete' | 'unknown'
  t: Translator
  togglePanel(panel: StudioPanelId): void
}

export function StudioRail(props: StudioRailProps) {
  const modelStatus = props.modelConfigured === undefined
    ? 'unknown'
    : props.modelConfigured ? 'configured' : 'incomplete'
  const modelLabel = props.t(props.modelConfigured === false ? 'rail.modelIncomplete' : 'rail.model')

  return (
    <nav className={styles.studioRail} aria-label={props.t('rail.label')} data-loom-component="utility-rail">
      <RailTab activePanel={props.activePanel} label={modelLabel} panel="model" status={modelStatus} t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="agent" t={props.t} togglePanel={props.togglePanel} />
      <span className={`loom-divider ${styles.railDivider}`} aria-hidden="true" />
      <RailTab activePanel={props.activePanel} panel="character" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="sessions" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="preset" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="resource" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="state" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="text-transform" t={props.t} togglePanel={props.togglePanel} />
      <span className={`loom-divider ${styles.railDivider}`} aria-hidden="true" />
      <RailTab activePanel={props.activePanel} panel="inspector" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="logs" t={props.t} togglePanel={props.togglePanel} />
      <button
        aria-label={props.t('rail.extensions')}
        className={styles.railTab}
        disabled
        title={props.t('rail.extensions')}
        type="button"
      >
        <Blocks aria-hidden="true" />
        <span className={styles.railLabel}>{props.t('rail.extensions')}</span>
      </button>
      <RailTab activePanel={props.activePanel} panel="settings" t={props.t} togglePanel={props.togglePanel} />
      {props.activePanel !== null ? (
        <footer className={styles.railFooter}>
          <a
            aria-label="LoomStudio GitHub"
            className={styles.githubLink}
            href="https://github.com/The-LoomStudio/LoomStudio.git"
            rel="noreferrer"
            target="_blank"
          >
            <GitHubMark />
            <span>GitHub</span>
          </a>
          <span className={styles.version}>v{STUDIO_VERSION}</span>
        </footer>
      ) : null}
    </nav>
  )
}

function RailTab(props: RailTabProps) {
  const active = props.activePanel === props.panel
  const incomplete = props.status === 'incomplete'
  const presentation = STUDIO_PANEL_PRESENTATION[props.panel]
  const label = props.label ?? props.t(presentation.labelKey)
  const Icon = presentation.Icon

  return (
    <button
      aria-label={label}
      aria-controls={`studio-${props.panel}-panel`}
      aria-expanded={active}
      className={[
        styles.railTab,
        active ? styles.railTabActive : '',
        incomplete ? styles.railTabIncomplete : '',
      ].filter(Boolean).join(' ')}
      data-status={props.status}
      title={label}
      type="button"
      onClick={() => props.togglePanel(props.panel)}
    >
      <Icon aria-hidden="true" />
      <span className={styles.railLabel}>{props.t(presentation.labelKey)}</span>
    </button>
  )
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.64 0 8c0 3.54 2.29 6.53 5.47 7.59.4.08.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.38-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82A7.65 7.65 0 0 1 8 3.87c.68 0 1.36.09 2 .27 1.53-1.05 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.05-1.87 3.74-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.38A8.01 8.01 0 0 0 16 8c0-4.36-3.58-8-8-8Z" />
    </svg>
  )
}
