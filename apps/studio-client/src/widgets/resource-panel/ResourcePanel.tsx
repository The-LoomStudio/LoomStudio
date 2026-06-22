import type { FormEvent } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import type { RendererPocState } from '../../entities/index.js'
import styles from './ResourcePanel.module.css'

type CardView = {
  id: string
  version: number
  name: string
}

type SessionView = {
  id: string
  agentRuntimeProfileId?: string
}

type BranchView = {
  id: string
  version: number
  title?: string
  headEntryId?: string
  forkedFromEntryId?: string
}



type ResourcePanelProps = {
  branch?: BranchView
  branches: BranchView[]
  busy: boolean
  cardJson: string
  cards: CardView[]
  customCss: string
  onAppendRendererMessage: () => void
  onChangeCardJson: (value: string) => void
  onChangeCustomCss: (value: string) => void
  onCreateCard: (event: FormEvent) => void
  onCreateRendererSession: () => void
  onCreateSessionFromCard: () => void
  onIncrementRendererLove: () => void
  onLoadTestCss: () => void
  onOpenRendererWindow: () => void
  onRefreshCards: () => void
  onResetCss: () => void
  onRevokeRendererSession: () => void
  onSelectCard: (cardId: string) => void
  onSwitchBranch: (branch: BranchView) => void
  rendererEvents: string[]
  rendererSessionId?: string
  rendererState?: RendererPocState
  selectedAgentRuntimeProfileId?: string
  selectedCard?: CardView
  selectedCardId?: string
  session?: SessionView
  t: Translator
}

export function ResourcePanel(props: ResourcePanelProps) {
  return (
    <aside className={styles.resourcePane} data-airp-component="resource-panel">
      <section className={styles.resourceSummary}>
        <p className={styles.resourceKicker}>Workspace</p>
        <h2>{props.t('app.title')}</h2>
        <p>{props.selectedCard?.name ?? props.t('session.none')}</p>
        <div className={styles.resourceActions}>
          <button type="button" onClick={() => props.onSelectCard('')}>+ {props.t('cards.create')}</button>
        </div>
      </section>

      <section className={`${styles.section} ${styles.resourceSection}`}>
        <div className={styles.sectionHead}>
          <h2>{props.t('cards.title')}</h2>
          <button type="button" onClick={props.onRefreshCards} disabled={props.busy}>{props.t('cards.refresh')}</button>
        </div>
        <div className={styles.list}>
          {props.cards.map(card => (
            <button
              className={card.id === props.selectedCardId ? `${styles.listItem} ${styles.selected}` : styles.listItem}
              key={card.id}
              type="button"
              onClick={() => props.onSelectCard(card.id)}
            >
              <span>{card.name}</span>
              <small>v{card.version}</small>
            </button>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.resourceSection}`}>
        <div className={styles.sectionHead}>
          <h2>{props.t('session.title')}</h2>
          <button type="button" onClick={props.onCreateSessionFromCard} disabled={props.busy || !props.selectedCardId}>
            {props.t('session.new')}
          </button>
        </div>
        <dl className={styles.meta}>
          <dt>{props.t('session.card')}</dt>
          <dd>{props.selectedCard?.name ?? props.t('session.none')}</dd>
          <dt>{props.t('session.session')}</dt>
          <dd>{props.session?.id ?? props.t('session.none')}</dd>
          <dt>{props.t('session.branch')}</dt>
          <dd>{props.branch?.id ?? props.t('session.none')}</dd>
          <dt>{props.t('session.head')}</dt>
          <dd>{props.branch?.headEntryId ?? props.t('session.empty')}</dd>
          <dt>{props.t('session.agent')}</dt>
          <dd>{props.session?.agentRuntimeProfileId ? shortId(props.session.agentRuntimeProfileId) : props.selectedAgentRuntimeProfileId ? shortId(props.selectedAgentRuntimeProfileId) : props.t('gateway.fake')}</dd>
        </dl>
        <div className={styles.branchList}>
          {props.branches.length === 0 ? (
            <div className={styles.emptyCompact}>{props.t('branch.noBranches')}</div>
          ) : props.branches.map(item => (
            <button
              className={item.id === props.branch?.id ? `${styles.branchItem} ${styles.selected}` : styles.branchItem}
              key={item.id}
              type="button"
              onClick={() => props.onSwitchBranch(item)}
              disabled={props.busy || item.id === props.branch?.id}
            >
              <span>{item.title ?? props.t('branch.default')}</span>
              <small>{item.headEntryId ? props.t('branch.head', { id: shortId(item.headEntryId) }) : props.t('branch.emptyHead')}</small>
              {item.forkedFromEntryId ? <small>{props.t('branch.fork', { id: shortId(item.forkedFromEntryId) })}</small> : null}
            </button>
          ))}
        </div>
      </section>



      <section className={`${styles.section} ${styles.resourceSection} ${styles.resourceDev}`}>
        <div className={styles.sectionHead}>
          <h2>{props.t('cards.create')}</h2>
        </div>
        <form className={styles.cardForm} onSubmit={props.onCreateCard}>
          <textarea value={props.cardJson} onChange={event => props.onChangeCardJson(event.target.value)} spellCheck={false} />
          <button type="submit" disabled={props.busy}>{props.t('cards.create')}</button>
        </form>
      </section>

      <section className={`${styles.section} ${styles.resourceSection} ${styles.resourceDev}`} data-airp-component="custom-renderer-host-panel">
        <div className={styles.sectionHead}>
          <h2>{props.t('renderer.title')}</h2>
          <small aria-live="polite">{props.rendererSessionId ? props.t('renderer.connected') : props.t('renderer.noSession')}</small>
        </div>
        <div className={styles.rendererPocControls}>
          <button type="button" onClick={props.onCreateRendererSession} disabled={props.busy}>{props.t('renderer.createSession')}</button>
          <button type="button" onClick={props.onOpenRendererWindow} disabled={!props.rendererSessionId}>{props.t('renderer.openRenderer')}</button>
          <button type="button" onClick={props.onIncrementRendererLove} disabled={!props.rendererSessionId || !props.rendererState || props.busy}>{props.t('renderer.lovePlusOne')}</button>
          <button type="button" onClick={props.onAppendRendererMessage} disabled={!props.rendererSessionId || props.busy}>{props.t('renderer.append')}</button>
          <button type="button" onClick={props.onRevokeRendererSession} disabled={!props.rendererSessionId || props.busy}>{props.t('renderer.revoke')}</button>
        </div>
        <dl className={styles.meta}>
          <dt>{props.t('renderer.session')}</dt>
          <dd>{props.rendererSessionId ?? props.t('session.none')}</dd>
          <dt>{props.t('renderer.love')}</dt>
          <dd>{props.rendererState?.loveLevel ?? '-'}</dd>
          <dt>{props.t('renderer.messages')}</dt>
          <dd>{props.rendererState?.messages.length ?? 0}</dd>
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
          {props.rendererEvents.map(item => <div key={item}>{item}</div>)}
        </div>
      </section>
    </aside>
  )
}

function shortId(id: string): string {
  return id.slice(0, 13)
}
