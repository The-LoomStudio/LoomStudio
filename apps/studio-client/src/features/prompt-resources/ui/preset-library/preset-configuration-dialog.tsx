import type { ReactNode } from 'react'
import { Dialog } from '@loom-studio/ui'
import styles from './preset-configuration-dialog.module.scss'

/** Shared overlay shell; mutations and their completion remain with the host. */
export function PresetConfigurationDialog(props: { open: boolean; title: string; source?: string; busy?: boolean; onClose(): void; children?: ReactNode; headerActions?: ReactNode }) {
  return <Dialog open={props.open} headerActions={props.headerActions} title={<><span>{props.title}</span>{props.source ? <span className={styles.source}>{props.source}</span> : null}</>} dismissible={!props.busy} closeOnBackdrop layout="workbench" className={styles.configurationDialog} onClose={props.onClose}>{props.children}</Dialog>
}
