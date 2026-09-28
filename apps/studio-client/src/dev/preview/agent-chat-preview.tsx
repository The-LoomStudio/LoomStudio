import { useEffect, useState } from 'react'
import { AgentChatPanel } from '../../widgets/agent-chat-panel/agent-chat-panel.js'
import { createTranslator } from '../../shared/i18n/index.js'
import { agentChatSample } from './agent-chat-sample.js'
import { applyEffectiveMotion, resolveEffectiveMotion, type MotionPreference } from '../../shared/hooks/use-motion-preference.js'

const t = createTranslator('zh-CN')

export function AgentChatPreview() {
  const [count, setCount] = useState(0)
  const [input, setInput] = useState('')
  const [motion, setMotion] = useState<MotionPreference>('system')
  useEffect(() => {
    const previous = document.documentElement.dataset.loomMotion
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => applyEffectiveMotion(resolveEffectiveMotion(motion, media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
      if (previous === undefined) delete document.documentElement.dataset.loomMotion
      else document.documentElement.dataset.loomMotion = previous
    }
  }, [motion])
  return (
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <nav>
        <button onClick={() => setCount(0)}>空会话</button>
        <button disabled={count >= agentChatSample.length} onClick={() => setCount(value => value + 1)}>下一条样例</button>
        <button onClick={() => setCount(agentChatSample.length)}>全部样例</button>
        <label>
          动态效果
          <select value={motion} onChange={event => setMotion(event.target.value as MotionPreference)}>
            <option value="system">跟随系统</option>
            <option value="full">完整</option>
            <option value="reduce">减少</option>
          </select>
        </label>
      </nav>
      <AgentChatPanel
        runRecoveryBusy={false}
        canRestoreRunInput={false}
        reconnectAgentRun={async () => undefined}
        restoreRunInput={() => undefined}
        busy={false}
        input={input}
        messages={agentChatSample.slice(0, count)}
        profiles={[]}
        providerAccounts={[]}
        t={t}
        onChangeInput={setInput}
        onSelectProfile={() => undefined}
        onSubmit={event => event.preventDefault()}
      />
    </main>
  )
}
