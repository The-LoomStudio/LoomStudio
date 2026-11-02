import { parseArgs } from 'node:util'
import { buildExtensionAuthoring } from './extension-authoring.js'

try {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, output: { type: 'string' }, resource: { type: 'string', multiple: true }, character: { type: 'string', multiple: true },
  } })
  if (!values.source || !values.output || (!values.resource?.length && !values.character?.length)) throw new Error('Usage: --source EXTENSION --output NEW_DIRECTORY [--resource CONTRIBUTION_ID=DIRECTORY] [--character CONTRIBUTION_ID=DIRECTORY]')
  const mappings = (values: string[]) => values.map(value => {
    const separator = value.indexOf('=')
    if (separator < 1 || separator === value.length - 1) throw new Error(`Invalid resource mapping: ${value}`)
    return { contributionId: value.slice(0, separator), directory: value.slice(separator + 1) }
  })
  console.log(JSON.stringify(await buildExtensionAuthoring({ sourceDirectory: values.source, outputDirectory: values.output, resources: mappings(values.resource ?? []), characters: mappings(values.character ?? []) })))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
