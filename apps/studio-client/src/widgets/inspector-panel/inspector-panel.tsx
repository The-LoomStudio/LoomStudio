import type { Translator } from '../../shared/i18n/index.js'
import { JsonBlock } from '../../shared/ui/json-block/json-block.js'
import type { PromptBuildStep } from '../../features/prompt-build/model/build-prompt-build-steps.js'
import { PromptBuildFlow } from '../prompt-build-flow/prompt-build-flow.js'
import styles from './inspector-panel.module.scss'

type InspectorPanelProps = {
  agentTranscript: unknown
  cardSnapshot: unknown
  promptBuildSteps: PromptBuildStep[]
  promptBuildTrace: unknown
  promptMessages: unknown
  providerPayloadPreview: unknown
  runDetails: unknown
  t: Translator
}

export function InspectorPanel(props: InspectorPanelProps) {
  return (
    <aside className={styles.inspector} data-loom-component="overlay-utility-layer" data-loom-object="inspector-panel">
      <section className={styles.section}>
        <h2>{props.t('inspector.cardSnapshot')}</h2>
        <JsonBlock value={props.cardSnapshot} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.run')}</h2>
        <JsonBlock value={props.runDetails} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.agentTranscript')}</h2>
        <JsonBlock value={props.agentTranscript} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.promptBuildFlow')}</h2>
        <PromptBuildFlow steps={props.promptBuildSteps} />
      </section>
      <section className={styles.section}>
        <h2>PromptBuild Trace</h2>
        <JsonBlock value={props.promptBuildTrace} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.prompt')}</h2>
        <JsonBlock value={props.promptMessages} />
      </section>
      <section className={styles.section}>
        <h2>Provider Payload</h2>
        <JsonBlock value={props.providerPayloadPreview} />
      </section>
    </aside>
  )
}
