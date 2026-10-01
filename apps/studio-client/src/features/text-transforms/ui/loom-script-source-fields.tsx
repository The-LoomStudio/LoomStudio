import type { Translator } from '../../../shared/i18n/index.js'
import styles from './text-transform-panel.module.scss'

export function LoomScriptSourceFields(props: {
  fileName: string
  source: string
  disabled?: boolean
  onFileNameChange(value: string): void
  onSourceChange(value: string): void
  t: Translator
}) {
  return <section className={styles.inspectionSection}>
    <h4>{props.t('textTransform.source')}</h4>
    <input aria-label={props.t('textTransform.scriptFileName')} className={styles.inlineInput}
      disabled={props.disabled} value={props.fileName} onChange={event => props.onFileNameChange(event.target.value)} />
    <textarea aria-label={props.t('textTransform.source')} className={styles.rawJsonTextarea}
      disabled={props.disabled} spellCheck={false} value={props.source} onChange={event => props.onSourceChange(event.target.value)} />
  </section>
}
