import type { CardSummary, NarrativeTimeline } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import styles from './recent-play-rail.module.scss'

type Props = {
  cards: CardSummary[]
  timelines: NarrativeTimeline[]
  t: Translator
  onOpenTimeline(timeline: NarrativeTimeline): void
}

export function RecentPlayRail(props: Props) {
  const mediaRevision = useCardMediaRevision()
  const recent = props.timelines.slice(0, 8)
  const groups = groupByDate(recent)
  return (
    <div className={styles.root} data-loom-component="rail-recent-play">
      {groups.map(group => <div className={styles.group} key={group.key}>
        <small className={styles.date}>{group.key}</small>
        {group.items.map(timeline => {
        const card = timeline.createdFrom ? props.cards.find(item => item.id === timeline.createdFrom?.cardId) : undefined
        const avatarUrl = card?.media?.avatarAssetId
          ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, mediaRevision)
          : undefined
        return (
          <button className={styles.item} key={timeline.id} type="button" onClick={() => props.onOpenTimeline(timeline)}>
            <span className={styles.avatar}>{avatarUrl ? <img src={avatarUrl} alt="" /> : card?.name?.slice(0, 1) ?? '·'}</span>
            <span className={styles.info}>
              <strong>{card?.name ?? timeline.title ?? timeline.id}</strong>
              <small>{new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timeline.updatedAt))}</small>
            </span>
          </button>
        )
      })}</div>)}
    </div>
  )
}

function groupByDate(items: NarrativeTimeline[]) {
  const groups = new Map<string, NarrativeTimeline[]>()
  for (const item of items) {
    const key = new Date(item.updatedAt).toLocaleDateString()
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].map(([key, group]) => ({ key, items: group }))
}
