import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import type { StudioPanelId } from './model/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from './model/studio-panel-presentation.js'
import styles from './studio-page.module.scss'

type StudioRailProps = {
  activePanel: StudioPanelId | null
  modelConfigured?: boolean
  recentSessions?: ReactNode
  t: Translator
  preloadPanel?(panel: StudioPanelId): void
  togglePanel(panel: StudioPanelId): void
}

type RailTabProps = {
  activePanel: StudioPanelId | null
  label?: string
  panel: StudioPanelId
  status?: 'configured' | 'incomplete' | 'unknown'
  t: Translator
  preloadPanel?(panel: StudioPanelId): void
  togglePanel(panel: StudioPanelId): void
}

export function StudioRail(props: StudioRailProps) {
  const [recentOpen, setRecentOpen] = useState(false)
  const modelStatus = props.modelConfigured === undefined
    ? 'unknown'
    : props.modelConfigured ? 'configured' : 'incomplete'
  const modelLabel = props.t(props.modelConfigured === false ? 'rail.modelIncomplete' : 'rail.model')

  return (
    <nav className={styles.studioRail} aria-label={props.t('rail.label')} data-loom-component="utility-rail">
      <div className={styles.railTopSection}>
        <div className={styles.railGroup}>
          <div className={styles.railGroupLabel}>{props.t('rail.groupConfig')}</div>
          <RailTab activePanel={props.activePanel} label={modelLabel} panel="model" preloadPanel={props.preloadPanel} status={modelStatus} t={props.t} togglePanel={props.togglePanel} />
          <RailTab activePanel={props.activePanel} panel="agent" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
        </div>

        <div className={styles.railGroup}>
          <div className={styles.railGroupLabel}>{props.t('rail.groupEdit')}</div>
          <RailTab activePanel={props.activePanel} panel="preset" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
          <RailTab activePanel={props.activePanel} panel="resource" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
          <RailTab activePanel={props.activePanel} panel="state" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
          <RailTab activePanel={props.activePanel} panel="text-transform" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
        </div>

        <div className={styles.railGroup}>
          <div className={styles.railGroupLabel}>{props.t('rail.groupPlay')}</div>
          <div className={styles.railPlayRow}>
            <RailTab activePanel={props.activePanel} panel="play" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
            {props.recentSessions && props.activePanel === null ? (
              <button className={styles.railPlayToggle} type="button" aria-expanded={recentOpen} aria-label={recentOpen ? '收起最近会话' : '展开最近会话'} onClick={() => setRecentOpen(value => !value)}>
                {recentOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              </button>
            ) : null}
          </div>
          {recentOpen && props.activePanel === null ? props.recentSessions : null}
        </div>
      </div>
      <div className={styles.railBottomSection}>
        <span className={`loom-divider ${styles.railDivider}`} aria-hidden="true" />
        <RailTab activePanel={props.activePanel} panel="inspector" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
        <RailTab activePanel={props.activePanel} panel="logs" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
        <RailTab activePanel={props.activePanel} panel="extensions" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
        <RailTab activePanel={props.activePanel} panel="settings" preloadPanel={props.preloadPanel} t={props.t} togglePanel={props.togglePanel} />
      </div>
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
      onFocus={() => props.preloadPanel?.(props.panel)}
      onMouseEnter={() => props.preloadPanel?.(props.panel)}
      onPointerDown={() => props.preloadPanel?.(props.panel)}
      onClick={() => props.togglePanel(props.panel)}
    >
      <Icon aria-hidden="true" />
      <span className={styles.railLabel}>{props.t(presentation.labelKey)}</span>
    </button>
  )
}
