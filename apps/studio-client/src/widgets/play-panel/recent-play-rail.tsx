import type { CardSummary, NarrativeTimeline } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { RecentCharacter } from '../../features/recent-characters/model/recent-characters.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import { useSlidingHover } from '../../shared/hooks/use-sliding-hover.js'
import { useScrollEdgeFade } from '../../shared/hooks/use-scroll-edge-fade.js'
import styles from './recent-play-rail.module.scss'

type Props = {
  cards: CardSummary[]
  timelines: NarrativeTimeline[]
  recent: RecentCharacter[]
  t: Translator
  onOpenCharacter(visit: RecentCharacter): void
}

export function RecentPlayRail(props: Props) {
  const mediaRevision = useCardMediaRevision()
  const recent = props.recent.flatMap(visit => {
    const card = props.cards.find(card => card.id === visit.cardId)
    return card ? [{ visit, card }] : []
  }).slice(0, 8)
  const slidingHover = useSlidingHover<HTMLDivElement>()
  useScrollEdgeFade(slidingHover.containerRef)
  return <div ref={slidingHover.containerRef} className={styles.root} data-loom-component="rail-recent-play"
    onPointerOver={slidingHover.onPointerOver} onPointerLeave={slidingHover.onPointerLeave}>
    <div className={styles.hoverIndicator} style={slidingHover.indicatorStyle} aria-hidden="true" />
    {!recent.length ? <p className={styles.empty}>{props.t('recentCharacters.empty')}</p> : null}
    {recent.map(({ visit, card }) => {
      const timeline = props.timelines.find(item => item.id === visit.timelineId && item.createdFrom?.cardId === card.id)
      const subtitle = timeline ? props.t('recentCharacters.continue', { title: timeline.title || props.t('sessions.untitledTimeline') }) : props.t('recentCharacters.choose')
      const avatar = card.media?.avatarAssetId ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, mediaRevision) : undefined
      return <button data-hover-item className={styles.item} key={card.id} type="button" onClick={() => props.onOpenCharacter(visit)}>
        <span className={styles.avatar}>{avatar ? <img src={avatar} alt="" /> : card.name.slice(0, 1)}</span>
        <span className={styles.info}><strong title={card.name}>{card.name}</strong><small title={subtitle}>{subtitle}</small></span>
      </button>
    })}
  </div>
}
