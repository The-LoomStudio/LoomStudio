export function SkeletonText(props: { className?: string; lines?: number }) {
  const lines = Math.max(1, Math.floor(props.lines ?? 3))
  return <span aria-hidden="true" className={props.className} data-loom-ui-skeleton-text="">{Array.from({ length: lines }, (_, index) => <span data-loom-ui-skeleton="" key={index} />)}</span>
}
