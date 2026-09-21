import { spawnSync } from 'node:child_process'

const checks = ['check:docs:links', 'check:docs:lifecycle']
let failed = false

for (const check of checks) {
  const result = spawnSync('pnpm', ['run', check], {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    failed = true
  }
}

if (failed) {
  process.exitCode = 1
}
