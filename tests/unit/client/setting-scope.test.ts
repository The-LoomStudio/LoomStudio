import { describe, expect, it } from 'vitest'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import { readSettingTreeMeta, resolveSettingScope } from '../../../apps/studio-client/src/widgets/context-workbench/setting-target.js'

const setting = (id: string, installationId?: string) => ({
  id,
  resourceKind: 'setting',
  ...(installationId ? { origin: { kind: 'extension-package', installationId } } : {}),
}) as PromptResource

describe('Settings scope', () => {
  it('shows placement anchors instead of editorial metadata for Setting entries', () => {
    expect(readSettingTreeMeta({
      id: 'entry', label: '世界观', kind: 'entry', meta: '基础 · System',
      capabilities: { targetAnchorId: '@setting.stable' },
    })).toBe('@setting.stable')
    expect(readSettingTreeMeta({ id: 'folder', label: '创作工作流', kind: 'folder', meta: '按需加载' })).toBeUndefined()
    expect(readSettingTreeMeta({ id: 'root', label: '资源', kind: 'folder', category: 'setting-root', meta: '当前卡片 · 工作区自有' })).toBe('当前卡片 · 工作区自有')
    expect(readSettingTreeMeta({ id: 'legacy', label: '旧条目', kind: 'entry', meta: '旧描述' })).toBeUndefined()
  })

  it('separates current Card references from global mounts and global extension installations', () => {
    const settings = [
      setting('card'), setting('manual-global'), setting('user-only'),
      setting('global-extension', 'global-install'), setting('card-extension', 'card-install'),
    ]
    const installations = [
      { id: 'global-install', target: { kind: 'global' } },
      { id: 'card-install', target: { kind: 'card' } },
    ]
    expect(resolveSettingScope(settings, new Set(['manual-global']), new Set(['card', 'card-extension']), installations, 'current')
      .map(item => item.id)).toEqual(['card', 'card-extension'])
    expect(resolveSettingScope(settings, new Set(['manual-global']), new Set(['card', 'card-extension']), installations, 'global')
      .map(item => item.id)).toEqual(['manual-global', 'global-extension'])
    expect(resolveSettingScope(settings, new Set(), new Set(), installations, 'current')).toEqual([])
  })
})
