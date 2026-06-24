import styles from './json-block.module.css'

export function JsonBlock(props: { value: unknown }) {
  return <pre className={styles.json}>{props.value === null || props.value === undefined ? 'null' : JSON.stringify(props.value, null, 2)}</pre>
}
