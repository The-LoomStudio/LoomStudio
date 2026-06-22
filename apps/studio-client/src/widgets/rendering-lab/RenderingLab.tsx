import type { Translator } from '../../shared/i18n/index.js'
import type { DisplayPart, RenderingLabMode, RenderingLabSample } from '../../features/rendering-lab/model/rendering-lab-sample.js'
import styles from './RenderingLab.module.css'

export function RenderingLab(props: {
  events: string[]
  mode: RenderingLabMode
  onAllowRawHtml: () => void
  onCreateRendererSession: () => Promise<void>
  onOpenRenderer: () => void
  onSelectChoice: (choice: string) => void
  onSelectMode: (mode: RenderingLabMode) => void
  rawHtmlAllowed: boolean
  rendererSessionId?: string
  sample: RenderingLabSample
  t: Translator
}) {
  const modes: RenderingLabMode[] = [
    'text',
    'inline-artifact',
    'raw-html',
    'iframe-artifact',
    'agent-choice',
    'agent-iframe',
    'new-tab',
  ]

  return (
    <div className={styles.renderingLab}>
      <div className={styles.sectionHead}>
        <h2>{props.t('renderingLab.title')}</h2>
        <small>{readRenderingSurfaceLabel(props.sample.surface, props.t)}</small>
      </div>

      <label className={styles.renderingLabMode}>
        {props.t('renderingLab.mode')}
        <select value={props.mode} onChange={event => props.onSelectMode(event.target.value as RenderingLabMode)}>
          {modes.map(mode => (
            <option key={mode} value={mode}>{readRenderingModeLabel(mode, props.t)}</option>
          ))}
        </select>
      </label>

      <div className={styles.renderingLabGrid}>
        <section className={styles.renderingLabPane}>
          <h3>{props.t('renderingLab.rawSource')}</h3>
          <pre>{props.sample.source}</pre>
        </section>
        <section className={styles.renderingLabPane}>
          <h3>{props.t('renderingLab.displayParts')}</h3>
          <pre>{JSON.stringify(props.sample.parts, null, 2)}</pre>
        </section>
      </div>

      <section className={styles.renderingLabResult}>
        <h3>{props.t('renderingLab.renderedResult')}</h3>
        {props.mode === 'new-tab' ? (
          <div className={styles.renderingLabNewTab}>
            <p>{props.t('renderingLab.newTabHint')}</p>
            <button type="button" onClick={props.onCreateRendererSession}>{props.t('renderer.createSession')}</button>
            <button type="button" onClick={props.onOpenRenderer} disabled={!props.rendererSessionId}>
              {props.t('renderer.openRenderer')}
            </button>
          </div>
        ) : (
          <div className={styles.renderingLabSurface} data-airp-render-surface={props.sample.surface}>
            {props.sample.parts.map((part, index) => (
              <RenderDisplayPart
                key={`${part.type}:${index}`}
                onAllowRawHtml={props.onAllowRawHtml}
                onSelectChoice={props.onSelectChoice}
                part={part}
                rawHtmlAllowed={props.rawHtmlAllowed}
                t={props.t}
              />
            ))}
          </div>
        )}
      </section>

      <div className={styles.eventLog} aria-label={props.t('renderingLab.eventLogLabel')}>
        {props.events.length === 0 ? <div>{props.t('renderingLab.noEvents')}</div> : props.events.map(item => <div key={item}>{item}</div>)}
      </div>
    </div>
  )
}

function RenderDisplayPart(props: {
  onAllowRawHtml: () => void
  onSelectChoice: (choice: string) => void
  part: DisplayPart
  rawHtmlAllowed: boolean
  t: Translator
}) {
  if (props.part.type === 'text') {
    return <p className={styles.renderPartText}>{props.part.text}</p>
  }

  if (props.part.type === 'html') {
    if (!props.rawHtmlAllowed) {
      return (
        <div className={styles.renderWarning} role="status">
          <strong>{props.t('renderingLab.rawHtmlWarningTitle')}</strong>
          <p>{props.t('renderingLab.rawHtmlWarningBody')}</p>
          <button type="button" onClick={props.onAllowRawHtml}>{props.t('renderingLab.allowRawHtml')}</button>
        </div>
      )
    }

    return <div className={styles.renderRawHtml} dangerouslySetInnerHTML={{ __html: props.part.html }} />
  }

  if (props.part.type === 'agent-action') {
    return (
      <div className={styles.agentChoiceCard} data-airp-component="agent-action-card">
        <strong>{props.t('renderingLab.agentChoiceTitle')}</strong>
        <div>
          {props.part.choices.map(choice => (
            <button key={choice.id} type="button" onClick={() => props.onSelectChoice(choice.id)}>
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (props.part.renderMode === 'iframe') {
    return (
      <iframe
        className={styles.renderIframe}
        sandbox="allow-scripts"
        srcDoc={props.part.content}
        title={props.t('renderingLab.iframeTitle')}
      />
    )
  }

  return (
    <figure className={styles.inlineArtifact} data-airp-artifact={props.part.artifactType}>
      <figcaption>{props.t('renderingLab.inlineArtifactLabel')}</figcaption>
      <blockquote>{props.part.content}</blockquote>
    </figure>
  )
}

function readRenderingModeLabel(mode: RenderingLabMode, t: Translator): string {
  if (mode === 'inline-artifact') return t('renderingLab.mode.inlineArtifact')
  if (mode === 'raw-html') return t('renderingLab.mode.rawHtml')
  if (mode === 'iframe-artifact') return t('renderingLab.mode.iframeArtifact')
  if (mode === 'agent-choice') return t('renderingLab.mode.agentChoice')
  if (mode === 'agent-iframe') return t('renderingLab.mode.agentIframe')
  if (mode === 'new-tab') return t('renderingLab.mode.newTab')
  return t('renderingLab.mode.text')
}

function readRenderingSurfaceLabel(surface: RenderingLabSample['surface'], t: Translator): string {
  if (surface === 'agent-panel') return t('renderingLab.surface.agentPanel')
  if (surface === 'custom-renderer') return t('renderingLab.surface.customRenderer')
  return t('renderingLab.surface.narrative')
}
