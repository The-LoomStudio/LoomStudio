import type { ReactNode } from 'react'

export type LongTextSurfaceProps = {
  title?: ReactNode
  description?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function LongTextSurface({ title, description, toolbar, children, footer, className }: LongTextSurfaceProps) {
  return (
    <section className={className} data-loom-long-text="">
      {title || description || toolbar ? (
        <header data-loom-long-text-header="">
          <div>
            {title ? <h3>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {toolbar ? <div data-loom-long-text-toolbar="">{toolbar}</div> : null}
        </header>
      ) : null}
      <div data-loom-long-text-content="">{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </section>
  )
}
