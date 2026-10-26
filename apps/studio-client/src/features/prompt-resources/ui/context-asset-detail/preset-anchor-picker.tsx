import { useState } from 'react'
import { Anchor, Check } from 'lucide-react'
import { Dialog, SearchField } from '@loom-studio/ui'
import type { PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { normalizeSearchText } from '../../../../shared/lib/text.js'
import { listPresetAnchorOptions } from '../../model/preset-anchor-options.js'
import styles from './context-asset-detail.module.scss'

export function PresetAnchorPicker(props: {
  presets: PromptResource[]
  selectedAnchorId?: string
  t: Translator
  onClose(): void
  onSelect(anchorId: string): void
}) {
  const [presetId, setPresetId] = useState(
    props.presets.find(preset => listPresetAnchorOptions(preset).some(anchor => anchor.id === props.selectedAnchorId))?.id
      ?? props.presets[0]?.id,
  )
  const [query, setQuery] = useState('')
  const preset = props.presets.find(candidate => candidate.id === presetId)
  const anchors = preset ? listPresetAnchorOptions(preset).filter(anchor =>
    normalizeSearchText(`${anchor.id} ${anchor.label}`).includes(normalizeSearchText(query)),
  ) : []

  return (
    <Dialog className={styles.anchorDialog} closeOnBackdrop open title={props.t('context.anchorPicker.title')} onClose={props.onClose}>
      <div className={styles.anchorPicker}>
        <nav className={styles.anchorPresets} aria-label={props.t('context.anchorPicker.presets')}>
          <span className={styles.anchorSectionTitle}>{props.t('context.anchorPicker.presets')}</span>
          {props.presets.length === 0 ? <p className={styles.anchorEmpty}>{props.t('context.anchorPicker.noPresets')}</p> : props.presets.map(candidate => (
            <button
              key={candidate.id}
              type="button"
              aria-current={candidate.id === presetId ? 'true' : undefined}
              className={candidate.id === presetId ? styles.anchorPresetSelected : undefined}
              onClick={() => { setPresetId(candidate.id); setQuery('') }}
            >
              <span>{candidate.rootNode.label}</span>
              <small>{listPresetAnchorOptions(candidate).length}</small>
            </button>
          ))}
        </nav>
        <div className={styles.anchorResults}>
          <SearchField
            containerClassName={styles.anchorSearch}
            autoFocus
            aria-label={props.t('context.anchorPicker.search')}
            placeholder={props.t('context.anchorPicker.search')}
            clearLabel={props.t('context.search.clear')}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
          <div className={styles.anchorList}>
            {(['common', 'custom'] as const).map(group => {
              const options = anchors.filter(anchor => anchor.common === (group === 'common'))
              return options.length ? <section key={group} aria-label={props.t(`context.anchorPicker.${group}`)}>
                <h3>{props.t(`context.anchorPicker.${group}`)}</h3>
                {options.map(anchor => (
                  <button key={anchor.id} type="button" onClick={() => props.onSelect(anchor.id)}>
                    <Anchor aria-hidden="true" />
                    <span>
                      <strong>{anchor.id}</strong>
                      {anchor.label !== anchor.id ? <small>{anchor.label}</small> : null}
                    </span>
                    {anchor.id === props.selectedAnchorId ? <Check aria-hidden="true" /> : null}
                  </button>
                ))}
              </section> : null
            })}
            {preset && anchors.length === 0 ? <p className={styles.anchorEmpty}>{props.t(query ? 'context.anchorPicker.noResults' : 'context.anchorPicker.noAnchors')}</p> : null}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
