// ==LoomScript==
// @format       1
// @id           alice.presentation
// @name         Alice Character Status
// @version      1.0.0
// @runtime      client-sandbox
// @capability   state.read
// @contribution {"kind":"renderer","id":"status-panel","surface":"narrative.entry.inline","scope":"node","inputs":["match:character-status"]}
// @contribution {"kind":"renderer","id":"status-summary","surface":"narrative.timeline.tail","scope":"timeline","inputs":["artifact:loom.character-status"]}
// ==/LoomScript==

function values(context, kind) {
  return context.inputs.filter(input => input.kind === kind).map(input => input.value)
}

function mountStatus(root, context, label, kind) {
  const items = values(context, kind)
  const section = document.createElement('section')
  const heading = document.createElement('strong')
  heading.textContent = label
  const content = document.createElement('pre')
  content.textContent = items.length > 0 ? items.map(item => typeof item === 'string' ? item : JSON.stringify(item, null, 2)).join('\n') : 'No character status data is available.'
  section.append(heading, content)
  root.replaceChildren(section)
}

export const renderers = {
  'status-panel': {
    mount(root, context) {
      mountStatus(root, context, 'Character status', 'match')
    },
  },
  'status-summary': {
    mount(root, context) {
      mountStatus(root, context, 'Latest character status', 'artifact')
    },
  },
}
