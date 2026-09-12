import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { inspectDataMigration, migrateDataDirectory } from './lib/data-directory-migration.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({
  options: {
    source: { type: 'string', default: resolve(root, '.loomstudio-dev/data') },
    target: { type: 'string', default: resolve(root, 'data') },
    apply: { type: 'boolean', default: false },
  },
})
const result = values.apply
  ? await migrateDataDirectory(values.source!, values.target!)
  : await inspectDataMigration(values.source!, values.target!)
console.log(JSON.stringify({ mode: values.apply ? 'copied-and-verified' : 'inspection-only', ...result }, null, 2))
