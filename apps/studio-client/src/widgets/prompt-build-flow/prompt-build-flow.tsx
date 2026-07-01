import type { PromptBuildStep } from '../../features/prompt-build/model/build-prompt-build-steps.js'
import styles from './prompt-build-flow.module.scss'

export function PromptBuildFlow(props: { steps: PromptBuildStep[] }) {
  return (
    <div className={styles.flow}>
      {props.steps.map(step => (
        <section className={styles.flowStep} key={step.title}>
          <h3>{step.title}</h3>
          <dl>
            {step.rows.map(row => (
              <div key={`${step.title}:${row.label}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
