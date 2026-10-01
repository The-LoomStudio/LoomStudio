import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(join(root, 'apps/studio-client/package.json'))
const { parse } = require('parse5')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const source = resolve(process.argv[2] ?? join(root, '.artifacts', `loom-studio-${manifest.version}`))
const sandbox = await mkdtemp(join(tmpdir(), 'loom release smoke '))
const directory = join(sandbox, 'application')
const home = join(sandbox, 'user')
let running

async function start() {
  let output = ''
  const ready = Promise.withResolvers()
  const child = spawn(process.execPath, [join(directory, 'scripts/start.mjs')], {
    cwd: sandbox,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: '0',
      LOOM_STUDIO_HOME: home, LOOM_STUDIO_DATA_ROOT: join(home, 'data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = Promise.withResolvers()
  running = { child, exited: exited.promise }
  child.on('error', error => ready.reject(error))
  child.once('exit', (code, signal) => {
    exited.resolve({ code, signal })
    ready.reject(new Error(`Release exited before startup (${code}, ${signal}): ${output}`))
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => {
      output = `${output}${chunk}`.slice(-16000)
      const match = /Loom Studio: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
      if (match) ready.resolve(match[1])
    })
  }
  const timeout = setTimeout(() => ready.reject(new Error(`Release startup timed out: ${output}`)), 45000)
  try {
    return await ready.promise
  } finally {
    clearTimeout(timeout)
  }
}

async function stop(validate = true) {
  if (!running) return
  const { child, exited } = running
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
  try {
    const result = await exited
    if (validate) {
      assert.ok(result.code === 0 || (process.platform === 'win32' && result.signal === 'SIGTERM'),
        `Release shutdown failed: ${JSON.stringify(result)}`)
    }
  } finally {
    clearTimeout(timeout)
    running = undefined
  }
}

try {
  await cp(source, directory, { recursive: true })
  const install = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: directory, stdio: 'inherit', shell: process.platform === 'win32',
  })
  if (install.error) throw install.error
  assert.equal(install.status, 0, 'Release-only dependency install failed')
  let origin = await start()
  for (const path of ['/', '/studio', '/studio/characters', '/studio/chat/smoke/branch/main']) {
    const response = await fetch(`${origin}${path}`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 200, path)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(await response.text(), /id="root"/)
  }
  const document = parse(await readFile(join(directory, 'apps/studio-client/dist/index.html'), 'utf8'))
  const assets = []
  function visit(node) {
    for (const attribute of node.attrs ?? []) {
      if (['src', 'href'].includes(attribute.name) && attribute.value.startsWith('/app-assets/')) assets.push(attribute.value)
    }
    for (const child of node.childNodes ?? []) visit(child)
  }
  visit(document)
  assert.ok(assets.some(path => path.endsWith('.js')), 'No built client script')
  for (const asset of assets) {
    const response = await fetch(`${origin}${asset}`, { signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 200, asset)
    assert.match(response.headers.get('cache-control'), /immutable/)
    assert.ok((await response.arrayBuffer()).byteLength > 0, asset)
  }
  const request = (path, options) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(10000) })
  assert.equal((await request('/app-assets/missing.js')).status, 404)
  assert.equal((await request('/rpc', { method: 'POST' })).status, 401)
  assert.equal((await request('/extensions/events')).status, 401)
  assert.equal((await request('/auth/session', { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } })).status, 403)
  async function session() {
    const response = await request('/auth/session', { method: 'POST', headers: { origin } })
    assert.equal(response.status, 204)
    return response.headers.get('set-cookie').split(';')[0]
  }
  let cookie = await session()
  async function rpc(method, params = {}) {
    const response = await request('/rpc', {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.error, undefined, JSON.stringify(body.error))
    return body.result
  }
  assert.equal((await rpc('system.ping', { echo: 'release-smoke' })).echo, 'release-smoke')
  const content = await rpc('official.listContent')
  assert.ok(content.packages[0].resources.every(resource => resource.available), 'Starter was not installed')
  assert.deepEqual((await rpc('extensions.listPackages')).items, [], 'Development extensions leaked into release')
  await stop()
  assert.ok((await stat(join(home, 'data/studio.sqlite'))).size > 0)
  origin = await start()
  cookie = await session()
  assert.deepEqual(await rpc('official.listContent'), content, 'Starter changed after restart')
  await stop()
  console.log('Release smoke passed: external cwd, static files, deep links, auth, starter, no dev extensions, restart and shutdown.')
} finally {
  try {
    await stop(false)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}
