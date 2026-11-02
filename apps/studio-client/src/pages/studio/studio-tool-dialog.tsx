import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { StudioPanelLoading } from './studio-panel-loading.js'

export function StudioToolDialog(props: {
  id: string
  open: boolean
  ready: boolean
  title: string
  icon: ReactNode
  closeLabel: string
  onClose(): void | Promise<void>
  onReturnToReading(): void
  render(active: boolean): ReactNode
}) {
  const open = props.ready && props.open
  const [visited, setVisited] = useState(open)
  useEffect(() => { if (open) setVisited(true) }, [open])

  return <Dialog id={props.id} open={open} onClose={props.onClose} title={props.title} titleIcon={props.icon}
    closeLabel={props.closeLabel} layout="workbench"
    headerActions={<Button onClick={props.onReturnToReading}>返回正文</Button>}>
    {visited || open ? <Suspense fallback={<StudioPanelLoading />}>
      {props.render(open)}
    </Suspense> : null}
  </Dialog>
}
