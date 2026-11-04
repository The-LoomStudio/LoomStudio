import { useEffect } from 'react'
import type { StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'

type UseStudioShortcutsOptions = {
  mobileDrawerOpen: boolean
  closeMobileDrawer(): void
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
  togglePanelWindowMode(): void
}

export function useStudioShortcuts(options: UseStudioShortcutsOptions) {
  const {
    mobileDrawerOpen,
    closeMobileDrawer,
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
      if (event.defaultPrevented || document.querySelector('dialog:modal')) return
      if (event.key === 'Escape' && isEditableTarget(event.target)) return
      if (event.key === 'Escape' && mobileDrawerOpen) {
        event.preventDefault()
        closeMobileDrawer()
        return
      }
      if (event.key === 'Escape' && assetMetadataOpen && (activePanel === 'resource' || activePanel === 'preset' || activePanel === 'agent')) {
        event.preventDefault()
        setAssetMetadataOpen(false)
        return
      }
      if (event.key === 'Escape' && activePanel !== null && isImmersive) {
        event.preventDefault()
        togglePanelWindowMode()
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
      } else if (key === 'z' && !event.shiftKey && canUndo) {
        event.preventDefault()
        onUndo()
      } else if (key === 'y' && canRedo) {
        event.preventDefault()
        onRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileDrawerOpen, closeMobileDrawer, activePanel, assetMetadataOpen, busy, canRedo, canUndo, closeDock, closePanel, dockOpen, isImmersive, onRedo, onUndo, setAssetMetadataOpen, togglePanelWindowMode])
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
