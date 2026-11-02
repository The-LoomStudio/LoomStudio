import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, IconButton } from '@loom-studio/ui'
import { Info } from 'lucide-react'
import { t } from '../../i18n/index.js'
import styles from './info-dialog.module.scss'

/** Shared, lazily mounted inspector for supplementary information. */
export function InfoDialog({ title, children }: { title: string; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  return <>
    <IconButton size="small" title={title} aria-label={title} aria-haspopup="dialog" onClick={event => {
      event.stopPropagation()
      setContainer(event.currentTarget.closest('dialog') ?? document.body)
    }}><Info size={16} aria-hidden="true" /></IconButton>
    {container && createPortal(<Dialog open title={title} closeLabel={t('observation.close')} onClose={() => setContainer(null)} className={styles.dialog}>
      <div className={styles.content}>{children}</div>
    </Dialog>, container)}
  </>
}
