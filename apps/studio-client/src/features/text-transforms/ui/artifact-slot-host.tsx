import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { RendererDefinition } from '../../../entities/index.js'

export function ArtifactSlotHost(props: {
  slot: RendererDefinition['slot']
  renderers: RendererDefinition[]
  artifacts: Array<{ id: string; artifactType: string; content: ClientJsonValue }>
}) {
  const visible = props.artifacts.flatMap(artifact => {
    const renderer = props.renderers.find(candidate => candidate.slot === props.slot && candidate.artifactType === artifact.artifactType)
    return renderer ? [{ artifact, renderer }] : []
  })
  return <section data-loom-component="artifact-slot-host" data-slot={props.slot}>
    {visible.map(({ artifact, renderer }) => renderer.renderMode === 'iframe'
      ? <iframe key={artifact.id} sandbox="" title={renderer.name} srcDoc={renderSandboxDocument(artifact.content)} />
      : <article key={artifact.id} data-renderer-id={renderer.id}><pre>{renderContent(artifact.content)}</pre></article>)}
  </section>
}

function renderContent(content: ClientJsonValue): string {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2)
}

function renderSandboxDocument(content: ClientJsonValue): string {
  const escaped = renderContent(content).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:12px;font:12px ui-monospace,monospace;white-space:pre-wrap}</style>${escaped}`
}
