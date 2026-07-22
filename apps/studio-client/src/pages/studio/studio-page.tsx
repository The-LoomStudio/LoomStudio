import { useEffect, useState, type ReactNode } from 'react'
import { FlaskConical, Users, PencilLine, Plug, BotMessageSquare, ScrollText } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './studio-page.module.scss'

type StudioPageProps = {
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  customCss: string
  editorPanel: ReactNode
  error?: string
  inspector: ReactNode
  logsPanel: ReactNode
  onRedo(): void
  onUndo(): void
  apiPanel: ReactNode
  presetPanel: ReactNode
  resourcePanel: ReactNode
  t: Translator
}

type ActivePanel = 'api' | 'preset' | 'resources' | 'editor' | 'inspector' | 'logs' | null

export function StudioPage(props: StudioPageProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>('resources')

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (props.busy || isEditableTarget(event.target)) return
      if (!event.metaKey && !event.ctrlKey) return

      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey && props.canRedo) {
        event.preventDefault()
        props.onRedo()
      } else if (key === 'z' && props.canUndo) {
        event.preventDefault()
        props.onUndo()
      } else if (key === 'y' && props.canRedo) {
        event.preventDefault()
        props.onRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [props.busy, props.canRedo, props.canUndo, props.onRedo, props.onUndo])

  function togglePanel(panel: Exclude<ActivePanel, null>) {
    setActivePanel(current => current === panel ? null : panel)
  }

  return (
    <main className={styles.workbench} data-loom-component="studio-host-poc">
      <style>{props.customCss}</style>
      <div className={styles.statusRegion} aria-live="polite">
        {props.error ? <div className={`${styles.status} ${styles.statusError}`}>{props.error}</div> : null}
        {props.busy ? <div className={styles.status}>{props.t('status.working')}</div> : null}
      </div>

      <section className={styles.studioStage} data-loom-component="application-layer-stage">
        <div className={styles.stageBase} data-loom-component="base-chat-canvas-layer">
          {props.canvas}
        </div>

        <nav className={styles.studioRail} aria-label={props.t('rail.label')} data-loom-component="utility-rail">
          <button
            aria-label={props.t('rail.api')}
            aria-controls="studio-api-panel"
            aria-expanded={activePanel === 'api'}
            className={activePanel === 'api' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            title={props.t('rail.api')}
            type="button"
            onClick={() => togglePanel('api')}
          >
            <Plug aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.5} />
            <span className={styles.railLabel}>{props.t('rail.api')}</span>
          </button>
          <button
            aria-label={props.t('rail.resources')}
            aria-controls="studio-resource-panel"
            aria-expanded={activePanel === 'resources'}
            className={activePanel === 'resources' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            title={props.t('rail.resources')}
            type="button"
            onClick={() => togglePanel('resources')}
          >
            <Users aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.5} />
            <span className={styles.railLabel}>{props.t('rail.resources')}</span>
          </button>
          <button
            aria-label={props.t('rail.preset')}
            aria-controls="studio-preset-panel"
            aria-expanded={activePanel === 'preset'}
            className={activePanel === 'preset' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            title={props.t('rail.preset')}
            type="button"
            onClick={() => togglePanel('preset')}
          >
            <BotMessageSquare aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.5} />
            <span className={styles.railLabel}>{props.t('rail.preset')}</span>
          </button>
          <button
            aria-label={props.t('rail.editor')}
            aria-controls="studio-editor-panel"
            aria-expanded={activePanel === 'editor'}
            className={activePanel === 'editor' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            title={props.t('rail.editor')}
            type="button"
            onClick={() => togglePanel('editor')}
          >
            <PencilLine aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.5} />
            <span className={styles.railLabel}>{props.t('rail.editor')}</span>
          </button>
          <button
            aria-label={props.t('rail.inspector')}
            aria-controls="studio-inspector-panel"
            aria-expanded={activePanel === 'inspector'}
            className={activePanel === 'inspector' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            title={props.t('rail.inspector')}
            type="button"
            onClick={() => togglePanel('inspector')}
          >
            <FlaskConical aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.5} />
            <span className={styles.railLabel}>{props.t('rail.inspector')}</span>
          </button>
          <button
            aria-label={props.t('rail.logs')}
            aria-controls="studio-logs-panel"
            aria-expanded={activePanel === 'logs'}
            className={activePanel === 'logs' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
            title={props.t('rail.logs')}
            type="button"
            onClick={() => togglePanel('logs')}
          >
            <ScrollText aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.5} />
            <span className={styles.railLabel}>{props.t('rail.logs')}</span>
          </button>
        </nav>

        <div
          className={activePanel === 'api'
            ? `${styles.stagePanel} ${styles.stagePanelLeft} ${styles.stagePanelActive}`
            : `${styles.stagePanel} ${styles.stagePanelLeft}`}
          id="studio-api-panel"
          aria-hidden={activePanel !== 'api'}
          hidden={activePanel !== 'api'}
          data-loom-component="overlay-api-layer"
        >
          {props.apiPanel}
        </div>

        <div
          className={activePanel === 'resources'
            ? `${styles.stagePanel} ${styles.stagePanelLeft} ${styles.stagePanelActive}`
            : `${styles.stagePanel} ${styles.stagePanelLeft}`}
          id="studio-resource-panel"
          aria-hidden={activePanel !== 'resources'}
          hidden={activePanel !== 'resources'}
          data-loom-component="overlay-resource-layer"
        >
          {props.resourcePanel}
        </div>

        <div
          className={activePanel === 'preset' ? `${styles.stageWorkspace} ${styles.stageWorkspaceActive}` : styles.stageWorkspace}
          id="studio-preset-panel"
          aria-hidden={activePanel !== 'preset'}
          hidden={activePanel !== 'preset'}
          data-loom-component="overlay-preset-layer"
        >
          {props.presetPanel}
        </div>

        <div
          className={activePanel === 'editor' ? `${styles.stageWorkspace} ${styles.stageWorkspaceActive}` : styles.stageWorkspace}
          id="studio-editor-panel"
          aria-hidden={activePanel !== 'editor'}
          hidden={activePanel !== 'editor'}
          data-loom-component="overlay-editor-layer"
        >
          {props.editorPanel}
        </div>

        <div
          className={activePanel === 'inspector'
            ? `${styles.stagePanel} ${styles.stagePanelRight} ${styles.stagePanelActive}`
            : `${styles.stagePanel} ${styles.stagePanelRight}`}
          id="studio-inspector-panel"
          aria-hidden={activePanel !== 'inspector'}
          hidden={activePanel !== 'inspector'}
          data-loom-component="overlay-inspector-layer"
        >
          {props.inspector}
        </div>

        <div
          className={activePanel === 'logs' ? `${styles.stageWorkspace} ${styles.stageWorkspaceActive}` : styles.stageWorkspace}
          id="studio-logs-panel"
          aria-hidden={activePanel !== 'logs'}
          hidden={activePanel !== 'logs'}
          data-loom-component="overlay-logs-layer"
        >
          {props.logsPanel}
        </div>
      </section>
    </main>
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
