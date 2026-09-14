import { Users } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { useCharacterGalleryStore } from './character-gallery-store.js'
import styles from './character-panel.module.scss'

export function CharacterPanelHeader(props: { t: Translator }) {
  const activeGroupId = useCharacterGalleryStore(state => state.activeGroupId)
  const groups = useCharacterGalleryStore(state => state.groups)
  const groupsOpen = useCharacterGalleryStore(state => state.groupsOpen)
  const setGroupsOpen = useCharacterGalleryStore(state => state.setGroupsOpen)
  const label = activeGroupId === 'ungrouped'
    ? props.t('character.ungrouped')
    : groups.find(group => group.id === activeGroupId)?.name ?? props.t('rail.character')

  return (
    <button aria-expanded={groupsOpen} aria-label={props.t('character.groups')} className={styles.headerTitle} type="button" onClick={() => setGroupsOpen(true)}>
      <Users aria-hidden="true" />
      <span className="loom-page-header-title">{label}</span>
    </button>
  )
}
