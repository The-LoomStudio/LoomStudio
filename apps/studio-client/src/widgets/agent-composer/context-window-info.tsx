import { useId, useState } from 'react'
import { t as defaultT, type Translator } from '../../shared/i18n/index.js'
import styles from './context-window-info.module.scss'

/** Unknown limits stay unknown; session usage is not the current context size. */
export function ContextWindowInfo(props?: { t?: Translator }) {
  const t = props?.t ?? defaultT
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  return <div className={styles.host} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setPinned(false); setHovered(false) } }}
    onKeyDown={event => { if (event.key === 'Escape') { setPinned(false); setHovered(false); event.stopPropagation() } }}>
    <button type="button" className={styles.trigger} aria-label={t('composer.contextInfo.aria')} aria-expanded={open} aria-controls={id}
      onClick={() => { setHovered(false); setPinned(value => !value) }} onFocus={() => setHovered(true)}>
      <svg className={styles.ring} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle className={styles.ringTrack} cx="12" cy="12" r="9" pathLength="100" strokeDasharray="3 5" />
        <circle cx="12" cy="12" r="9" pathLength="100" strokeDasharray="0 100" transform="rotate(-90 12 12)" />
      </svg>
    </button>
    {open && <div id={id} className={styles.panel} role="region" aria-label={t('composer.contextInfo.title')}>
      <strong>{t('composer.contextInfo.window')}</strong>
      <dl><div><dt>{t('composer.contextInfo.currentUsage')}</dt><dd>{t('composer.contextInfo.noData')}</dd></div><div><dt>{t('composer.contextInfo.modelLimit')}</dt><dd>{t('composer.contextInfo.unknown')}</dd></div><div><dt>{t('composer.contextInfo.sessionTotal')}</dt><dd>{t('composer.contextInfo.noData')}</dd></div></dl>
    </div>}
  </div>
}
