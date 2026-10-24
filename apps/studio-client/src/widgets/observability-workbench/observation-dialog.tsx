import { useState, type ReactNode } from 'react'
import { ArrowUpRight, Copy } from 'lucide-react'
import { Button, Dialog } from '@loom-studio/ui'
import type { Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import styles from './observability-workbench.module.scss'

export function ObservationDialogButton({ title, description, children, t }: {
  title: string; description?: string; children(): ReactNode; t: Translator
}) {
  const [open, setOpen] = useState(false)
  return <>
    <Button size="small" className={styles.inspectorTrigger} aria-haspopup="dialog" onClick={() => setOpen(true)}><ArrowUpRight size={14} />{title}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}
      closeLabel={t('observation.close')} className={styles.inspectorDialog}>
      {open ? children() : null}
    </Dialog>
  </>
}

export function ObservationRawData({ title, value, text, t }: {
  title: string; value?: unknown; text?: string; t: Translator
}) {
  return <ObservationDialogButton title={title} t={t}>{() => <RawDataContent text={text ?? (value === undefined ? t('observation.missing') : JSON.stringify(value, null, 2))} t={t} />}</ObservationDialogButton>
}

function RawDataContent({ text, t }: { text: string; t: Translator }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  return <div className={styles.inspectorContent}>
    <div className={styles.inspectorActions}><Button size="small" onClick={async () => setCopied(await tryWriteClipboardText(text) ? 'copied' : 'failed')}><Copy size={14} />{t(copied === 'copied' ? 'observation.copied' : 'observation.copy')}</Button>
      {copied === 'failed' && <span role="status">{t('observation.copyFailed')}</span>}
    </div>
    <pre className={styles.rawData}>{text}</pre>
  </div>
}
