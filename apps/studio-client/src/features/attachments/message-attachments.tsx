import type { ChatAttachment } from '@loom-studio/shared'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './attachment-cards.module.scss'
import { AttachmentCards } from './attachment-cards.js'

export function MessageAttachments({ attachments, t, align = 'start' }: { attachments?: ChatAttachment[]; t?: Translator; align?: 'start' | 'end' }) {
  if (!attachments?.length) return null
  return <div className={align === 'end' ? styles.messageEnd : styles.messageStart}><AttachmentCards items={attachments.map(attachment => ({ id: attachment.assetId, name: attachment.name, attachment }))} t={t} /></div>
}
