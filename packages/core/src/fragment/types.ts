export interface Fragment<M = unknown> {
  readonly id: string
  readonly content: string
  readonly meta: M
}
