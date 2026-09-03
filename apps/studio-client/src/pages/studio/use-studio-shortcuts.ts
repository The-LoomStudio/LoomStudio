import { useEffect } from 'react'
import type { StudioPanelId } from './model/studio-layout-store.js'

type UseStudioShortcutsOptions = {
  activePanel: StudioPanelId | null
  assetMetadataOpen: boolean
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  dockOpen: boolean
  isImmersive: boolean
  closeDock(): void
  closePanel(): void
  onRedo(): void
  onUndo(): void
  setAssetMetadataOpen(open: boolean): void
  togglePanelWindowMode(panel?: StudioPanelId): void
}

export function useStudioShortcuts(options: UseStudioShortcutsOptions) {
  const {
    activePanel,
    assetMetadataOpen,
    busy,
    canRedo,
    canUndo,
    closeDock,
    closePanel,
    dockOpen,
    isImmersive,
    onRedo,
    onUndo,
    setAssetMetadataOpen,
    togglePanelWindowMode,
  } = options

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && isEditableTarget(event.target)) return
      if (event.key === 'Escape' && assetMetadataOpen && (activePanel === 'resource' || activePanel === 'preset')) {
        event.preventDefault()
        setAssetMetadataOpen(false)
        return
      }
      if (event.key === 'Escape' && activePanel !== null && isImmersive) {
        event.preventDefault()
        togglePanelWindowMode(activePanel)
        return
      }
      if (event.key === 'Escape' && (activePanel !== null || dockOpen)) {
        event.preventDefault()
        if (activePanel !== null) closePanel()
        else closeDock()
        return
      }
      if (busy || isEditableTarget(event.target)) return
      if (!event.metaKey && !event.ctrlKey) return

      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey && canRedo) {
        event.preventDefault()
        onRedo()
      } else if (key === 'z' && canUndo) {
        event.preventDefault()
        onUndo()
      } else if (key === 'y' && canRedo) {
        event.preventDefault()
        onRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePanel, assetMetadataOpen, busy, canRedo, canUndo, closeDock, closePanel, dockOpen, isImmersive, onRedo, onUndo, setAssetMetadataOpen, togglePanelWindowMode])
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
