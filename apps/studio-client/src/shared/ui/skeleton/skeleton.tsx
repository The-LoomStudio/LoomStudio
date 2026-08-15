import styles from './skeleton.module.scss'

export function Skeleton(props: { className?: string; shape?: 'line' | 'block' | 'circle' }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.skeleton} ${props.className ?? ''}`}
      data-loom-component="skeleton"
      data-shape={props.shape ?? 'line'}
    />
  )
}

export function SkeletonText(props: { className?: string; lines?: number }) {
  const lines = Math.max(1, Math.floor(props.lines ?? 3))
  return (
    <span aria-hidden="true" className={`${styles.text} ${props.className ?? ''}`}>
      {Array.from({ length: lines }, (_, index) => <Skeleton key={index} />)}
    </span>
  )
}
