import studioLogoUrl from '../shared/assets/logo.png'
import { StartupReady } from './startup-curtain.js'
import type { ReactNode } from 'react'
import styles from './app-status-page.module.scss'

type AppStatusPageProps = {
  actions: ReactNode
  children?: ReactNode
  description: string
  eyebrow: string
  prominentEyebrow?: boolean
  title: string
}

export function AppStatusPage(props: AppStatusPageProps) {
  return (
    <main className={styles.page} data-loom-component="app-status-page">
      <StartupReady />
      <section className={styles.panel}>
        <img className={styles.logo} src={studioLogoUrl} alt="Loom Studio" />
        <div className={styles.content}>
        <p className={props.prominentEyebrow ? styles.prominentEyebrow : styles.eyebrow}>{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p className={styles.description}>{props.description}</p>
        <div className={styles.actions}>{props.actions}</div>
        {props.children}
        </div>
      </section>
    </main>
  )
}
