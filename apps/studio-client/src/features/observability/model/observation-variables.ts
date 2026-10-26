import type { ObservationStep } from './observation-view.js'

type VariableRead = ObservationStep['variables'][number]
type MacroGroup = {
  id: string
  name: string
  path: string
  source: string
  count: number
  values: string[]
  consumers: Array<VariableRead & { id: string; count: number }>
}

export function groupMacroReads(reads: VariableRead[]): MacroGroup[] {
  const groups = new Map<string, MacroGroup>()
  for (const read of reads) {
    const id = JSON.stringify([read.name, read.path, read.source])
    let group = groups.get(id)
    if (!group) {
      group = { id, name: read.name, path: read.path, source: read.source, count: 0, values: [], consumers: [] }
      groups.set(id, group)
    }
    group.count += 1
    if (!group.values.includes(read.value)) group.values.push(read.value)
    const consumerId = JSON.stringify([read.hostId, read.stage, read.value])
    const consumer = group.consumers.find(item => item.id === consumerId)
    if (consumer) consumer.count += 1
    else group.consumers.push({ ...read, id: consumerId, count: 1 })
  }
  return [...groups.values()]
}
