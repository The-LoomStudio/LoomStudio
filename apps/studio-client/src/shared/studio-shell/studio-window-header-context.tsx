import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { StudioPanelId } from './studio-layout-store.js'

type StudioWindowHeaderContextValue = {
  activePanel: StudioPanelId | null
  actionsTarget: HTMLElement | null
}

const StudioWindowHeaderContext = createContext<StudioWindowHeaderContextValue>({
  activePanel: null,
  actionsTarget: null,
})

export function StudioWindowHeaderProvider(props: StudioWindowHeaderContextValue & { children: ReactNode }) {
  return <StudioWindowHeaderContext.Provider value={props}>{props.children}</StudioWindowHeaderContext.Provider>
}

export function PanelHeaderActions(props: { children: ReactNode; panel: StudioPanelId }) {
  const header = useContext(StudioWindowHeaderContext)
  if (!canRenderPanelHeaderContribution(header.activePanel, props.panel, header.actionsTarget)) return null
  return createPortal(props.children, header.actionsTarget)
}

export function canRenderPanelHeaderContribution(
  activePanel: StudioPanelId | null,
  ownerPanel: StudioPanelId,
  target: HTMLElement | null,
): target is HTMLElement {
  return activePanel === ownerPanel && target !== null
}
