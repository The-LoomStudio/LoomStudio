import type { Translator } from '../../shared/i18n/index.js'
import type { StudioPanelId } from './model/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from './model/studio-panel-presentation.js'
import styles from './studio-page.module.scss'

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
      <RailTab activePanel={props.activePanel} panel="extensions" t={props.t} togglePanel={props.togglePanel} />
      <RailTab activePanel={props.activePanel} panel="settings" t={props.t} togglePanel={props.togglePanel} />
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
