import { messages as observation } from './ja-jp/observation.js'
import { messages as userProfile } from './ja-jp/user-profile.js'
import { messages as common } from './ja-jp/common.js'
import { messages as sessions } from './ja-jp/sessions.js'
import { messages as agent } from './ja-jp/agent.js'
import { messages as resources } from './ja-jp/resources.js'
import { messages as characters } from './ja-jp/characters.js'
import { messages as state } from './ja-jp/state.js'
import { messages as prompt } from './ja-jp/prompt.js'
import { messages as extensions } from './ja-jp/extensions.js'
import { messages as settings } from './ja-jp/settings.js'
import { messages as textTransforms } from './ja-jp/textTransforms.js'
import { messages as logs } from './ja-jp/logs.js'
import { messages as notifications } from './ja-jp/notifications.js'
import { messages as search } from './ja-jp/search.js'
import type { zhCN } from './zh-cn.js'

export const jaJP = {
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
