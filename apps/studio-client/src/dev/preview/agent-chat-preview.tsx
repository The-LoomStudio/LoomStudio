import { useState } from 'react'
import { AgentChatPanel } from '../../widgets/agent-chat-panel/agent-chat-panel.js'
import { createTranslator } from '../../shared/i18n/index.js'
import { agentChatSample } from './agent-chat-sample.js'

const t = createTranslator('zh-CN')

export function AgentChatPreview() {
  const [count, setCount] = useState(0)
  const [input, setInput] = useState('')
  return (
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <nav>
        <button onClick={() => setCount(0)}>空会话</button>
        <button disabled={count >= agentChatSample.length} onClick={() => setCount(value => value + 1)}>下一条样例</button>
        <button onClick={() => setCount(agentChatSample.length)}>全部样例</button>
      </nav>
      <AgentChatPanel
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
