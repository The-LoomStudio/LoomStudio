import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createRegexPreviewRuntime } from '../../../scripts/dev/regex-preview-runtime.js'
import { regexLabSamples } from '../../../apps/studio-client/src/dev-preview/regex-lab-samples.js'
import type { RegexLabState, RegexLabProjection } from '../../../apps/studio-client/src/dev-preview/regex-lab-contract.js'

it('uses native adopted rules and real save-time classification, surviving a SQLite reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-regex-lab-'))
  let lab = await createRegexPreviewRuntime(directory)
  try {
    for (const id of ['finish', 'records', 'partial']) {
      const sample = regexLabSamples.find(item => item.id === id)!
      await lab.handle({ action: 'install', caseId: id, sources: sample.sources })
      const partial = await lab.handle({ action: 'project', text: '<Message|Alice|20:39>在', streaming: true }) as RegexLabProjection
      expect(partial.matches).toBe(id === 'partial' ? 1 : 0)
      const complete = await lab.handle({ action: 'project', text: '<Message|Alice|20:39>在吗</Message>', streaming: true }) as RegexLabProjection
      expect(complete.matches).toBe(id === 'finish' ? 0 : 1)
      const final = await lab.handle({ action: 'project', text: '<Message|Alice|20:39>在吗</Message>', streaming: false }) as RegexLabProjection
      expect(final.matches).toBe(1)
      expect(final.text).toContain('<p>在吗</p>')
    }
    for (const sample of regexLabSamples.filter(item => item.expected !== undefined)) {
      await lab.handle({ action: 'install', caseId: sample.id, sources: sample.sources })
      const result = await lab.handle({ action: 'project', text: sample.input, streaming: false }) as RegexLabProjection
      expect(result.text, sample.name).toBe(sample.expected)
    }
    const sample = regexLabSamples.find(item => item.id === 'persist')!
    await lab.handle({ action: 'install', caseId: sample.id, sources: sample.sources })
    const committed = await lab.handle({ action: 'commit', text: sample.input }) as RegexLabState
    expect(committed.history.some(item => item.kind === 'reasoning' && item.text.includes('检查格式'))).toBe(true)
    const reply = committed.history.findLast(item => item.kind === 'assistant')!
    expect(reply.text).toContain('[已移除]')
    expect(reply.text).not.toContain('<think>')
    expect(reply.text).not.toContain('demo-token')
    expect(reply.text).not.toContain('投影')
    expect(committed.storedDisplay).toContain('【显示投影】')
    expect(committed.storedPrompt).toContain('【提示词投影】')
    await lab.close()
    lab = await createRegexPreviewRuntime(directory)
    const restored = await lab.handle({ action: 'state' }) as RegexLabState
    expect(restored.history).toEqual(committed.history)
    expect(restored.rules).toEqual(committed.rules)
  } finally { await lab.close(); await rm(directory, { recursive: true, force: true }) }
}, 30_000)
