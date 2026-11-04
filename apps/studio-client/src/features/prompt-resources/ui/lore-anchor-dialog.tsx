import { Dialog } from '@loom-studio/ui'
import type { ContextAssetNode } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { groupLoreByAnchor } from '../model/lore-anchor-projection.js'
import styles from './lore-anchor-dialog.module.scss'

export function LoreAnchorDialog(props: { root: ContextAssetNode; t: Translator; onClose(): void }) {
  const groups = groupLoreByAnchor(props.root)
  return <Dialog open closeOnBackdrop title={`${props.t('context.anchors.title')} · ${props.root.label}`} onClose={props.onClose} className={styles.dialog}>
    <div className={styles.content}>
      <p className={styles.hint}>{props.t('context.anchors.hint')}</p>
      {!groups.length && <p>{props.t('context.anchors.empty')}</p>}
      {groups.map(group => <section key={group.anchorId ?? ''} className={styles.group}>
        <h3>{group.anchorId ? <code>{group.anchorId}</code> : props.t('context.anchors.unassigned')} <span>{group.entries.length}</span></h3>
        {!group.anchorId && <p className={styles.hint}>{props.t('context.anchors.unassignedHint')}</p>}
        <ol>
          {group.entries.map(entry => <li key={entry.node.id} className={entry.enabled ? undefined : styles.disabled}>
            <div className={styles.entry}>
              <span>{entry.node.label}</span>
              <small>{!entry.enabled ? props.t('context.anchors.disabled')
                : entry.conditional ? props.t('context.activation.badgeConditional')
                  : props.t('context.activation.badgeAlways')}</small>
            </div>
            <div className={styles.path}>{entry.path}</div>
          </li>)}
        </ol>
      </section>)}
    </div>
  </Dialog>
}
