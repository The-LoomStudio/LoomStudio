import type { ClientExtensionActivationContext } from '@loom-studio/extension-sdk'

export function activate(ctx: ClientExtensionActivationContext) {
  const headings = new Set<HTMLElement>()
  let labelPrefix = 'Example Echo'
  const applyConfigs = (entries: Awaited<ReturnType<typeof ctx.configs.list>>) => {
    const configured = entries.find(entry => entry.key === 'label-prefix')?.value
    labelPrefix = typeof configured === 'string' ? configured : 'Example Echo'
    for (const heading of headings) heading.textContent = `${labelPrefix} extension renderer`
  }
  void ctx.configs.list({ scope: { kind: 'global' } }).then(entries => {
    if (!ctx.signal.aborted) applyConfigs(entries)
  })
  ctx.configs.subscribe({ scope: { kind: 'global' } }, applyConfigs)
  ctx.renderers.register({
    id: 'character-status',
    name: 'Example Echo Character Status',
    surface: 'narrative.timeline.tail',
    instanceScope: 'timeline',
    adapter: 'shadow',
    fallback: 'text',
  }, {
    mount(root, context) {
      const section = document.createElement('section')
      const heading = document.createElement('strong')
      heading.textContent = `${labelPrefix} extension renderer`
      headings.add(heading)
      const content = document.createElement('p')
      content.textContent = context.part?.type === 'text' ? context.part.content : 'No projected status is available.'
      section.append(heading, content)
      root.replaceChildren(section)
      return { dispose: () => { headings.delete(heading) } }
    },
  })
}
