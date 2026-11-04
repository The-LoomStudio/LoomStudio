import { useState, type CSSProperties } from 'react'
import { Bot, Cog, UserRound, Wrench, MessagesSquare, ListChecks, Braces, CheckCircle2, TriangleAlert, CircleDashed } from 'lucide-react'
import { Button, SearchField, Tabs } from '@loom-studio/ui'
import type { Translator } from '../../../shared/i18n/index.js'
import { useTokenCounts } from '../../../shared/tokenizer/use-token-counts.js'
import type { ObservationMessage, ObservationStep } from '../model/observation-view.js'
import { groupObservationMessages, groupedMessageDetail } from '../model/observation-message-groups.js'
import { definitionTokenParts, messageMatches, messagePreview, messageTokenParts, sumTokenParts, type TokenPart } from '../model/observation-token-view.js'
import { tryWriteClipboardText } from '../../../shared/browser/clipboard.js'
import { ToolArguments, ToolResult } from './observation-content.js'
import { ObservationDialogButton, RawDataContent } from './observation-dialog.js'
import styles from './observability-workbench.module.scss'

type Props = { step: ObservationStep; changesOnly: boolean; onSource(id?: string): void; t: Translator }

// Match the preset message tree's role palette and icons.
const messageAppearance: Record<string, { color: string; Icon: typeof Bot }> = {
  system: { color: 'var(--loom-color-info)', Icon: Cog },
  developer: { color: 'var(--loom-color-accent-strong)', Icon: Cog },
  assistant: { color: 'var(--loom-color-success)', Icon: Bot },
  user: { color: 'var(--loom-color-warning)', Icon: UserRound },
  tool: { color: 'var(--loom-color-accent)', Icon: Wrench },
  calls: { color: 'var(--loom-color-accent-strong)', Icon: Braces },
  definitions: { color: 'var(--loom-color-text-muted)', Icon: ListChecks },
}
const unknownAppearance = { color: 'var(--loom-color-text-muted)', Icon: MessagesSquare }

export function ObservationMessages({ step, changesOnly, onSource, t }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('order')
  const [groupFilter, setGroupFilter] = useState<string>()
  const [showUnchanged, setShowUnchanged] = useState(false)
  const current = [...messageTokenParts(step.messages), ...definitionTokenParts(step.toolDefinitions)]
  const previous = [...messageTokenParts(step.previousMessages ?? []), ...definitionTokenParts(step.previousToolDefinitions)]
  const removed = messageTokenParts(step.removedMessages ?? [])
  const all = [...current, ...previous, ...removed]
  const texts = [...new Set(all.map(part => part.text))]
  const counted = useTokenCounts(texts, step.id)
  const counts = new Map(texts.map((text, index) => [text, counted.currentCounts[index]]))
  const total = step.evidence?.messages === false ? undefined : sumTokenParts(current, counts)
  const format = (value: number | undefined) => value === undefined ? t('observation.tokenUnknown') : `≈ ${value.toLocaleString()}`
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString()}`
  const messageCount = (message: ObservationMessage) => sumTokenParts(messageTokenParts([message]), counts)
  const parts = current
  const groupKey = (part: TokenPart) => part.group
  const groupLabel = (key: string) => {
    const labels: Record<string, 'system' | 'user' | 'assistant' | 'tool' | 'calls' | 'definitions' | 'always' | 'conditional' | 'manual' | 'unassigned'> = { system: 'system', user: 'user', assistant: 'assistant', tool: 'tool', calls: 'calls', definitions: 'definitions', always: 'always', conditional: 'conditional', keyword: 'conditional', condition: 'conditional', all: 'conditional', manual: 'manual', unassigned: 'unassigned' }
    return labels[key] ? t(`observation.tokens.${labels[key]}`) : key
  }
  const groupColor = (key: string) => (messageAppearance[key] ?? unknownAppearance).color
  const grouped = new Map<string, TokenPart[]>()
  parts.forEach(part => { const key = groupKey(part); grouped.set(key, [...(grouped.get(key) ?? []), part]) })
  const groups = [...grouped].map(([key, items]) => ({ key, items, count: sumTokenParts(items, counts) })).sort((a, b) => (b.count ?? -1) - (a.count ?? -1))
  const distributionTotal = sumTokenParts(parts, counts)
  const filteredChanges = changesOnly && step.canCompare && !showUnchanged && !query && !groupFilter
  const messageGroups = groupObservationMessages(step.messages)
  const unchangedCount = messageGroups.filter(members => members.every(message => !message.change)).reduce((sum, members) => sum + members.length, 0)
  const visible = messageGroups.filter(members =>
    (!filteredChanges || members.some(message => message.change)) && members.some(message => messageMatches(message, query)) &&
    (!groupFilter || members.some(message => current.some(part => part.messageId === message.id && part.group === groupFilter))))
  const groupCount = (members: ObservationMessage[]) => sumTokenParts(messageTokenParts(members), counts)
  if (sort === 'tokens') visible.sort((a, b) => (groupCount(b) ?? -1) - (groupCount(a) ?? -1))
  const beforeTotal = step.previousMessages && sumTokenParts(previous, counts)
  const added = sumTokenParts(messageTokenParts(step.messages.filter(message => message.changeKind === 'added')), counts)
  const deleted = sumTokenParts(removed, counts)
  const comparableTools = (step.toolDefinitions === undefined) === (step.previousToolDefinitions === undefined)
  const delta = comparableTools && total !== undefined && beforeTotal !== undefined ? total - beforeTotal : undefined
  const changed = delta !== undefined && added !== undefined && deleted !== undefined ? delta - added + deleted : undefined
  return <div className={styles.inputMessageList}>
    <section className={styles.tokenOverview} aria-label={t('observation.tokenOverview')}>
      <div className={styles.sectionHeading}><strong>{t('observation.tokenOverview')} · {format(total)} tokens</strong><small>{t('observation.messageCount', { count: step.messages.length })}</small></div>
      <p className={styles.hint}>{t('observation.localTokenNote')}</p>
      {step.kind !== 'build' && step.toolDefinitions === undefined && <small>{t('observation.toolDefinitionsUnknown')}</small>}
      {counted.error ? <p role="status">{t('observation.tokenFailed')} {counted.error}</p> : counted.pending && <small role="status">{t('observation.tokenCounting')}</small>}
      {step.evidence && !step.evidence.messages && <p role="status">{t('observation.messagesMissingHint')}</p>}
      {groups.length ? <>
        <div className={styles.tokenBar} aria-label={t('observation.tokenOverview')}>
          {distributionTotal !== undefined && distributionTotal > 0 && groups.map(group => group.count! > 0 && <button key={group.key} type="button" style={{ flex: group.count, background: groupColor(group.key) }} title={`${groupLabel(group.key)} · ${format(group.count)} tokens · ${(group.count! / distributionTotal * 100).toFixed(1)}%`} aria-label={`${groupLabel(group.key)} · ${format(group.count)} tokens`} aria-pressed={groupFilter === group.key} onClick={() => setGroupFilter(groupFilter === group.key ? undefined : group.key)} />)}
        </div>
        <div className={styles.tokenLegend}>{groups.map(group => <button type="button" key={group.key} aria-pressed={groupFilter === group.key} onClick={() => setGroupFilter(groupFilter === group.key ? undefined : group.key)}><span className={styles.tokenDot} style={{ background: groupColor(group.key) }} /><span>{groupLabel(group.key)}</span><strong>{format(group.count)}</strong><small>{distributionTotal && group.count !== undefined ? `${(group.count / distributionTotal * 100).toFixed(1)}%` : '—'}</small></button>)}</div>
        {groupFilter && <Button size="small" onClick={() => setGroupFilter(undefined)}>{t('observation.clearTokenFilter')}</Button>}
      </> : <p className={styles.hint}>{t('observation.tokenSourcesMissing')}</p>}
      {step.canCompare && <div className={styles.tokenDelta}><strong>{t('observation.tokenDelta')} {delta === undefined ? '—' : `≈ ${signed(delta)}`}</strong><span>{t('observation.tokenAdded')} {added === undefined ? '—' : `+${added.toLocaleString()}`}</span><span>{t('observation.tokenModified')} {changed === undefined ? '—' : signed(changed)}</span><span>{t('observation.tokenRemoved')} {deleted === undefined ? '—' : `−${deleted.toLocaleString()}`}</span></div>}
    </section>
    <p className={styles.hint}>{t(step.kind === 'build' ? 'observation.buildHint' : 'observation.requestHint')}</p>
    {step.comparison && <p className={styles.hint}>{step.comparison}</p>}
    {!step.canCompare && step.kind !== 'build' && <p className={styles.hint}>{t(step.initialInput ? 'observation.initialInput' : 'observation.comparisonMissing')}</p>}
    <div className={styles.messageControls}><SearchField aria-label={t('observation.searchMessages')} placeholder={t('observation.searchMessages')} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('observation.clearSearch')} /><Tabs size="compact" ariaLabel={t('observation.messageSort')} activeId={sort} onChange={setSort} items={[{ id: 'order', label: t('observation.sendOrder') }, { id: 'tokens', label: t('observation.tokenOrder') }]} /></div>
    {filteredChanges && unchangedCount > 0 && <button type="button" className={styles.unchangedMessages} onClick={() => setShowUnchanged(true)}>{t('observation.unchangedCount', { count: unchangedCount })}</button>}
    {visible.map(members => <ObservationMessageCard key={members[0].id} message={groupedMessageDetail(members)} members={members.length > 1 ? members : undefined} memberTokens={members.map(messageCount)} index={step.messages.indexOf(members[0])} tokens={groupCount(members)} query={query} onSource={() => onSource(members[0].sourceId)} t={t} />)}
    {!visible.length && <p className={styles.hint}>{t('observation.noMatches')}</p>}
    {groupFilter === 'definitions' && <RawDataContent text={JSON.stringify(step.toolDefinitions, null, 2) ?? ''} t={t} />}
    {!!step.removedMessages?.length && <details className={styles.removedMessages}><summary>{t('observation.removedCount', { count: step.removedMessages.length })}</summary>{step.removedMessages.filter(message => messageMatches(message, query)).map(message => <ObservationMessageCard key={message.id} message={message} tokens={messageCount(message)} query={query} onSource={() => {}} t={t} />)}</details>}
  </div>
}

export function ObservationMessageCard({ message, members, memberTokens, index, tokens, query = '', onSource, t }: { message: ObservationMessage; members?: ObservationMessage[]; memberTokens?: Array<number | undefined>; index?: number; tokens?: number; query?: string; onSource(): void; t: Translator }) {
  const { color, Icon } = messageAppearance[message.role] ?? unknownAppearance
  return <fieldset className={`${styles.message} ${styles.messageFrame} ${styles.roleMessage}`} style={{ '--loom-message-role-color': color } as CSSProperties}>
    <legend className={styles.frameLegend}><span className={styles.frameHeading}>{members ? <span className={styles.messageGroupHeading}>{members.map((member, offset) => { const appearance = messageAppearance[member.role] ?? unknownAppearance; const RoleIcon = appearance.Icon; return <span key={member.id} style={{ color: appearance.color }}>{offset > 0 && <span aria-hidden="true">→</span>}<RoleIcon size={15} aria-hidden="true" />{member.role} <small>#{member.position ?? (index ?? 0) + offset + 1}</small>{member.change && <span className={styles.change}>{member.change}</span>}</span> })}</span> : <><span className={styles.role}><Icon size={15} aria-hidden="true" />{message.role}</span>{(message.position !== undefined || index !== undefined) && <small>#{message.position ?? index! + 1}</small>}</>}{!members && message.change && <span className={styles.change}>{message.change}</span>}<span className={styles.frameLine} /><span className={styles.headingActions}>{[...new Set(message.exchanges?.map(exchange => exchange.status) ?? [])].map(status => <ToolExchangeStatus key={status} status={status} t={t} />)}<small>{tokens === undefined ? t('observation.tokenUnknown') : `≈ ${tokens.toLocaleString()} tokens`}</small><ObservationDialogButton icon title={t('observation.messageDetail')} t={t}>{() => <><div className={styles.messageGroupUsage}>{members?.map((member, offset) => <span key={member.id}>{member.role} #{member.position ?? (index ?? 0) + offset + 1} · {memberTokens?.[offset] === undefined ? t('observation.tokenUnknown') : `≈ ${memberTokens[offset]!.toLocaleString()} tokens`}</span>)}</div><MessageDetail message={message} initialQuery={query} t={t} /></>}</ObservationDialogButton></span></span></legend>
    {!!message.exchanges?.length && <div className={styles.toolMessageNames}>{[...new Set(message.exchanges.map(exchange => exchange.name ?? t('observation.unknownTool')))].join(' · ')}</div>}
    <div className={`${styles.messageText} ${styles.messageSummary}`}>{messagePreview(message, query) || '—'}</div>
    {members?.slice(1).map(member => <div key={member.id} className={styles.groupedToolOutput}><span className={styles.sourceRoleBadge}><Wrench size={14} aria-hidden="true" />{t('observation.toolOutput')}</span><div className={styles.messageSummary}>{messagePreview(member, query) || '—'}</div></div>)}
    {message.sourceId && <div className={styles.messageActions}><button type="button" className={styles.referenceLink} onClick={onSource}>{t('observation.locateSource')}</button></div>}
  </fieldset>
}

function MessageDetail({ message, initialQuery, t }: { message: ObservationMessage; initialQuery: string; t: Translator }) {
  const [view, setView] = useState('content')
  const [query, setQuery] = useState(initialQuery)
  const [matchIndex, setMatchIndex] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const content = message.exchanges?.length ? [message.role === 'assistant' ? message.content : '', ...message.exchanges.map(exchange => [exchange.name, typeof exchange.input === 'string' ? exchange.input : JSON.stringify(exchange.input, null, 2), typeof exchange.result === 'string' ? exchange.result : JSON.stringify(exchange.result, null, 2)].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n') : [message.content, ...(message.toolCalls ?? []).map(call => `${call.name}\n${call.arguments}`)].filter(Boolean).join('\n\n')
  const text = view === 'content' ? content : message.raw === undefined ? t('observation.missing') : JSON.stringify(message.raw, null, 2)
  const matches: number[] = []
  if (query) {
    const lower = text.toLocaleLowerCase(), needle = query.toLocaleLowerCase()
    for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + needle.length)) matches.push(index)
  }
  const active = matches.length ? matchIndex % matches.length : 0
  return <div className={styles.inspectorContent}>
    <Tabs ariaLabel={t('observation.messageDetail')} activeId={view} onChange={value => { setView(value); setMatchIndex(0) }} items={[{ id: 'content', label: t('observation.fullContent') }, { id: 'raw', label: t('observation.rawMessage') }]} />
    <SearchField aria-label={t('observation.searchMessages')} placeholder={t('observation.searchMessages')} value={query} onChange={event => { setQuery(event.target.value); setMatchIndex(0) }} onClear={() => setQuery('')} clearLabel={t('observation.clearSearch')} />
    {query && <div className={styles.inspectorActions}><span role="status">{matches.length ? active + 1 : 0} / {matches.length}</span><Button size="small" disabled={!matches.length} onClick={() => setMatchIndex((active + matches.length - 1) % matches.length)}>{t('observation.previousMatch')}</Button><Button size="small" disabled={!matches.length} onClick={() => setMatchIndex(active + 1)}>{t('observation.nextMatch')}</Button></div>}
    {query && matches.length > 0 && <pre className={styles.searchExcerpt}>{text.slice(Math.max(0, matches[active] - 100), matches[active])}<mark>{text.slice(matches[active], matches[active] + query.length)}</mark>{text.slice(matches[active] + query.length, matches[active] + query.length + 200)}</pre>}
    {view === 'content' && message.exchanges?.length ? <div className={styles.toolExchangeList}><div className={styles.inspectorActions}><Button size="small" onClick={async () => setCopyState(await tryWriteClipboardText(text) ? 'copied' : 'failed')}>{t(copyState === 'copied' ? 'observation.copied' : 'observation.copy')}</Button>{copyState === 'failed' && <span role="status">{t('observation.copyFailed')}</span>}</div>{message.role === 'assistant' && message.content && <ToolResult value={message.content} t={t} />}{message.exchanges.map((exchange, index) => <section className={styles.toolExchange} key={exchange.callId ?? index}>
      <div className={styles.sectionHeading}><strong><Wrench size={16} aria-hidden="true" /> {exchange.name ?? t('observation.unknownTool')}</strong><ToolExchangeStatus status={exchange.status} t={t} /></div>
      <section className={styles.toolExchangePart}><h4>{t('observation.toolRequest')}</h4><ToolArguments value={exchange.input} t={t} /></section>
      <section className={styles.toolExchangePart} data-failed={['failed', 'denied', 'aborted'].includes(exchange.status)}><h4>{t('observation.toolOutput')}</h4><ToolResult value={exchange.result} t={t} /></section>
    </section>)}</div> : <RawDataContent text={text} t={t} />}
  </div>
}

export function ObservationRoleBadge({ role, t }: { role: string; t: Translator }) {
  const { color, Icon } = messageAppearance[role] ?? unknownAppearance
  const label = role === 'system' || role === 'user' || role === 'assistant' || role === 'tool' ? t(`observation.tokens.${role}`) : role
  return <span className={styles.sourceRoleBadge} style={{ color }}><Icon size={14} aria-hidden="true" />{label}</span>
}

export function ToolExchangeStatus({ status, t }: { status: string; t: Translator }) {
  const success = status === 'completed'
  const failure = status === 'failed' || status === 'denied' || status === 'aborted'
  const Icon = success ? CheckCircle2 : failure ? TriangleAlert : CircleDashed
  const label = success ? t('observation.toolSucceeded') : status === 'failed' ? t('observation.failed') : status === 'aborted' ? t('observation.aborted') : status === 'denied' ? t('observation.toolDenied') : status === 'skipped' ? t('observation.toolSkipped') : status === 'running' ? t('observation.running') : status === 'queued' ? t('observation.pendingResult') : t('observation.toolStatusUnknown')
  return <span className={styles.status} data-status={success ? 'completed' : failure ? 'failed' : status}><Icon size={13} aria-hidden="true" />{label}</span>
}
