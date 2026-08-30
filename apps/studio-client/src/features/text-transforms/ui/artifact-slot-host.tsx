import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { RendererDefinition } from '../../../entities/index.js'

export function ArtifactSlotHost(props: {
  surface: RendererDefinition['surface']
  renderers: RendererDefinition[]
  artifacts: Array<{ id: string; artifactType: string; content: ClientJsonValue }>
}) {
  const visible = props.artifacts.flatMap(artifact => {
    const renderer = props.renderers.find(candidate => candidate.surface === props.surface && candidate.artifactType === artifact.artifactType)
    return renderer ? [{ artifact, renderer }] : []
  })
  return <section data-loom-component="artifact-slot-host" data-surface={props.surface}>
    {visible.map(({ artifact, renderer }) => <article key={artifact.id} data-renderer-id={renderer.id}><pre>{renderContent(artifact.content)}</pre></article>)}
  </section>
}

function renderContent(content: ClientJsonValue): string {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2)
}
