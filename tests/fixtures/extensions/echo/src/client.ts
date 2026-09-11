import type { ClientExtensionActivationContext } from '@loom-studio/extension-sdk'

export function activate(ctx: ClientExtensionActivationContext) {
  return ctx.renderers.register({
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
      heading.textContent = 'Example Echo extension renderer'
      const content = document.createElement('p')
      content.textContent = context.part?.type === 'text' ? context.part.content : 'No projected status is available.'
      section.append(heading, content)
      root.replaceChildren(section)
    },
  })
}
