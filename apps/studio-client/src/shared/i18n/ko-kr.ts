import { messages as observation } from './ko-kr/observation.js'
import { messages as userProfile } from './ko-kr/user-profile.js'
import { messages as common } from './ko-kr/common.js'
import { messages as sessions } from './ko-kr/sessions.js'
import { messages as agent } from './ko-kr/agent.js'
import { messages as resources } from './ko-kr/resources.js'
import { messages as characters } from './ko-kr/characters.js'
import { messages as state } from './ko-kr/state.js'
import { messages as prompt } from './ko-kr/prompt.js'
import { messages as extensions } from './ko-kr/extensions.js'
import { messages as settings } from './ko-kr/settings.js'
import { messages as textTransforms } from './ko-kr/textTransforms.js'
import { messages as logs } from './ko-kr/logs.js'
import { messages as notifications } from './ko-kr/notifications.js'
import { messages as search } from './ko-kr/search.js'
import type { zhCN } from './zh-cn.js'

export const koKR = {
  ...common,
  ...observation,
  ...userProfile,
  ...sessions,
  ...agent,
  ...resources,
  ...characters,
  ...state,
  ...prompt,
  ...extensions,
  ...settings,
  ...textTransforms,
  ...logs,
  ...notifications,
  ...search,
} satisfies Record<keyof typeof zhCN, string>
