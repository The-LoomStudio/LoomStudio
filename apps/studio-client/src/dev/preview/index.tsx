import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import '../../styles/global.css'
import { AgentChatPreview } from './agent-chat-preview.js'
import { NarrativeTimelinePreview } from './narrative-timeline-preview.js'
import { LongTextEditorPreview } from './long-text-editor-preview.js'
import { MarkdownContentPreview } from './markdown-content-preview.js'
import { FileTreePreview } from './file-tree-preview.js'
import { ResourceRegistryPreview } from './resource-registry/resource-registry-preview.js'

const previews: Record<string, () => ReactElement> = { 'agent-chat': AgentChatPreview, 'narrative-timeline': NarrativeTimelinePreview, 'long-text-editor': LongTextEditorPreview, 'markdown-content': MarkdownContentPreview, 'file-tree': FileTreePreview, 'resource-registry': ResourceRegistryPreview }

export function renderComponentPreview(root: HTMLElement, previewId: string): void {
  const Preview = previews[previewId]
  createRoot(root).render(Preview ? <Preview /> : <PreviewNotFound previewId={previewId} />)
}

function PreviewNotFound(props: { previewId: string }) {
  return <main style={{ padding: 24 }}>Preview not found: {props.previewId}</main>
}
