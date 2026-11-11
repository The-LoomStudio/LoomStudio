import { Bot, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { LogReferenceLabel } from '../../features/log-viewer/model/use-log-reference-labels.js'
import { presetIconUrl, useExtensionIdentities } from '../../shared/ui/extension-icon/extension-icon.js'
import { cardMediaUrl } from '../../shared/lib/card-media.js'
import { resolveModelBrand } from '../../features/provider-settings/model/model-brand.js'
import { ModelBrandIcon } from '../../features/provider-settings/ui/model-brand-icon.js'
import styles from './log-origin.module.scss'

export function LogOrigin({ source, title, modelId, compact = false, metadata }: { metadata?: ReactNode; source?: LogReferenceLabel['source']; title: string; modelId?: string; compact?: boolean }) {
  const packages = useExtensionIdentities()
  const [failed, setFailed] = useState<string[]>([])
  const presetUrl = source?.preset ? presetIconUrl(source.preset, packages) : undefined
  const cardUrl = source?.cardId ? cardMediaUrl(source.cardId, 'avatar', source.avatarAssetId, 0) : undefined
  const hasAvatar = !!presetUrl && !failed.includes(presetUrl)
  const modelText = modelId || (!source?.preset ? title : '')
  const brand = modelText ? resolveModelBrand(modelText) : null
  return <span className={styles.origin} data-compact={compact || undefined}>
    <span className={`${styles.avatar} ${hasAvatar ? '' : styles.placeholder}`}>{hasAvatar
      ? <img src={presetUrl} alt="" onError={() => setFailed(current => [...current, presetUrl])} />
      : <ModelBrandIcon brand={brand} className={styles.modelBrandIcon} fallback={<Bot aria-hidden="true" />} />}</span>
    <span className={styles.labels}><span className={styles.titleRow}><strong title={source?.presetName ?? title}>{source?.presetName ?? title}</strong>{metadata}</span>{source?.cardId && <small>
      {cardUrl && !failed.includes(cardUrl) ? <img src={cardUrl} alt="" onError={() => setFailed(current => [...current, cardUrl])} /> : <UserRound aria-hidden="true" />}
      <span title={source.cardName ?? source.cardId}>{source.cardName ?? source.cardId}</span>
    </small>}</span>
  </span>
}
