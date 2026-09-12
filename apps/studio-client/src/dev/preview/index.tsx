import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { ComponentPreviewApp } from './component-preview-app.js'
import { CardResourcesPreview } from './card-resources-preview.js'
import '../../styles/global.css'

const previews: Record<string, () => ReactElement> = {
  'text-pipeline': ComponentPreviewApp,
  'card-resources': CardResourcesPreview,
}

export function renderComponentPreview(root: HTMLElement, previewId: string): void {
  const Preview = previews[previewId]
  createRoot(root).render(Preview ? <Preview /> : <PreviewNotFound previewId={previewId} />)
}

function PreviewNotFound(props: { previewId: string }) {
  return <main style={{ padding: 24 }}>Preview not found: {props.previewId}</main>
}
