import { HeroArtwork } from './hero-artwork.js'
import { useState, type ReactNode } from 'react'
import type { CardSummary } from '../../../entities/index.js'
import { cardMediaUrl, useCardMediaRevision } from '../../lib/card-media.js'
import styles from './story-hero.module.scss'

type StoryHeroProps = {
  label?: ReactNode
  title: string
  character?: Pick<CardSummary, 'id' | 'name' | 'media'>
  description?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
  compact?: boolean
}

/** Presentation only: callers retain story selection, navigation and mutation ownership. */
export function StoryHero({ label, title, character, description, metadata, actions, compact = false }: StoryHeroProps) {
  const revision = useCardMediaRevision()
  const [failedUrl, setFailedUrl] = useState<string>()
  const url = character && cardMediaUrl(character.id, 'avatar', character.media?.avatarAssetId, revision)
  const image = url && url !== failedUrl ? url : undefined
  return <div className={`${styles.hero} ${compact ? styles.compact : ''} ${!image ? styles.noArt : ''}`}>
    <div className={styles.layout}>
    {image && <div className={styles.art}><HeroArtwork src={image} onError={() => setFailedUrl(image)} /></div>}
    <div className={styles.content}>
      {(label || character) && <div className={styles.top}><span>{label}</span><span>{character?.name}</span></div>}
      <h3 className={styles.title}>{title}</h3>
      {description && <div className={styles.description}>{description}</div>}
      {(metadata || actions) && <div className={styles.footer}><span>{metadata}</span><div className={styles.actions}>{actions}</div></div>}
    </div>
    </div>
  </div>
}
