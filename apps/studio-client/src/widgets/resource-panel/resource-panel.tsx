import type { FormEvent } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import type { RendererPocState } from '../../entities/index.js'
import { RendererResourceSection } from './renderer-resource-section.js'
import styles from './resource-panel.module.css'

type CardView = {
  id: string
  version: number
  name: string
  userName?: string
  description?: string
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
  cardDraft: { name: string; userName: string; description: string }
  cardJson: string
  cards: CardView[]
  customCss: string
  onAppendRendererMessage: () => void
  onChangeCardDraft: (draft: { name: string; userName: string; description: string }) => void
  onChangeCardJson: (value: string) => void
  onChangeCustomCss: (value: string) => void
  onCreateCard: (event: FormEvent) => void
  onCreateRendererSession: () => void
  onCreateSessionFromCard: () => void
  onDeleteCard: () => void
  onIncrementRendererLove: () => void
  onLoadTestCss: () => void
  onOpenRendererWindow: () => void
  onRefreshCards: () => void
  onResetCss: () => void
  onRevokeRendererSession: () => void
  onSelectCard: (cardId: string) => void
  onSwitchBranch: (branch: BranchView) => void
  onUpdateCard: (event: FormEvent) => void
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
    <aside className={styles.resourcePane} data-loom-component="resource-panel">
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
          <h2>Card Detail</h2>
          <button type="button" onClick={props.onDeleteCard} disabled={props.busy || !props.selectedCardId}>Delete</button>
        </div>
        <form className={styles.cardForm} onSubmit={props.onUpdateCard}>
          <label className={styles.fieldLabel}>
            <span>Name</span>
            <input
              value={props.cardDraft.name}
              disabled={props.busy || !props.selectedCardId}
              onChange={event => props.onChangeCardDraft({ ...props.cardDraft, name: event.target.value })}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>User</span>
            <input
              value={props.cardDraft.userName}
              disabled={props.busy || !props.selectedCardId}
              onChange={event => props.onChangeCardDraft({ ...props.cardDraft, userName: event.target.value })}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>Description</span>
            <textarea
              className={styles.compactTextarea}
              value={props.cardDraft.description}
              disabled={props.busy || !props.selectedCardId}
              onChange={event => props.onChangeCardDraft({ ...props.cardDraft, description: event.target.value })}
            />
          </label>
          <button type="submit" disabled={props.busy || !props.selectedCardId || props.cardDraft.name.trim().length === 0}>Save Card</button>
        </form>
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

      <RendererResourceSection
        busy={props.busy}
        customCss={props.customCss}
        events={props.rendererEvents}
        onAppendMessage={props.onAppendRendererMessage}
        onChangeCustomCss={props.onChangeCustomCss}
        onCreateSession={props.onCreateRendererSession}
        onIncrementLove={props.onIncrementRendererLove}
        onLoadTestCss={props.onLoadTestCss}
        onOpenWindow={props.onOpenRendererWindow}
        onResetCss={props.onResetCss}
        onRevokeSession={props.onRevokeRendererSession}
        sessionId={props.rendererSessionId}
        state={props.rendererState}
        t={props.t}
      />
    </aside>
  )
}

function shortId(id: string): string {
  return id.slice(0, 13)
}
