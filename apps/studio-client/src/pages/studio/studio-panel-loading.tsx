import { LoadingText } from '@loom-studio/ui'
import styles from './studio-page.module.scss'

export function StudioPanelLoading() {
  return <div aria-busy="true" className={styles.panelLoading}><LoadingText /></div>
}
