import type { RendererPocState } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './ResourcePanel.module.css'

type RendererResourceSectionProps = {
  busy: boolean
  customCss: string
  events: string[]
  onAppendMessage: () => void
  onChangeCustomCss: (value: string) => void
  onCreateSession: () => void
  onIncrementLove: () => void
  onLoadTestCss: () => void
  onOpenWindow: () => void
  onResetCss: () => void
  onRevokeSession: () => void
  sessionId?: string
  state?: RendererPocState
  t: Translator
}

export function RendererResourceSection(props: RendererResourceSectionProps) {
  return (
    <section className={`${styles.section} ${styles.resourceSection} ${styles.resourceDev}`} data-airp-component="custom-renderer-host-panel">
      <div className={styles.sectionHead}>
        <h2>{props.t('renderer.title')}</h2>
        <small aria-live="polite">{props.sessionId ? props.t('renderer.connected') : props.t('renderer.noSession')}</small>
      </div>
      <div className={styles.rendererPocControls}>
        <button type="button" onClick={props.onCreateSession} disabled={props.busy}>{props.t('renderer.createSession')}</button>
        <button type="button" onClick={props.onOpenWindow} disabled={!props.sessionId}>{props.t('renderer.openRenderer')}</button>
        <button type="button" onClick={props.onIncrementLove} disabled={!props.sessionId || !props.state || props.busy}>{props.t('renderer.lovePlusOne')}</button>
        <button type="button" onClick={props.onAppendMessage} disabled={!props.sessionId || props.busy}>{props.t('renderer.append')}</button>
        <button type="button" onClick={props.onRevokeSession} disabled={!props.sessionId || props.busy}>{props.t('renderer.revoke')}</button>
      </div>
      <dl className={styles.meta}>
        <dt>{props.t('renderer.session')}</dt>
        <dd>{props.sessionId ?? props.t('session.none')}</dd>
        <dt>{props.t('renderer.love')}</dt>
        <dd>{props.state?.loveLevel ?? '-'}</dd>
        <dt>{props.t('renderer.messages')}</dt>
        <dd>{props.state?.messages.length ?? 0}</dd>
      </dl>
      <div className={styles.customCssEditor}>
        <div className={styles.customCssHead}>
          <span>{props.t('renderer.customCss')}</span>
          <span className={styles.customCssActions}>
            <button type="button" onClick={props.onLoadTestCss}>{props.t('renderer.loadTestCss')}</button>
            <button type="button" onClick={props.onResetCss}>{props.t('renderer.resetCss')}</button>
          </span>
        </div>
        <textarea
          value={props.customCss}
          onChange={event => props.onChangeCustomCss(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className={styles.eventLog} aria-label={props.t('renderer.eventLogLabel')}>
        {props.events.map(item => <div key={item}>{item}</div>)}
      </div>
    </section>
  )
}
