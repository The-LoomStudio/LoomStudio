import { messages as observation } from './en-us/observation.js'
import { messages as userProfile } from './en-us/user-profile.js'
import { messages as common } from './en-us/common.js'
import { messages as sessions } from './en-us/sessions.js'
import { messages as agent } from './en-us/agent.js'
import { messages as resources } from './en-us/resources.js'
import { messages as characters } from './en-us/characters.js'
import { messages as state } from './en-us/state.js'
import { messages as prompt } from './en-us/prompt.js'
import { messages as extensions } from './en-us/extensions.js'
import { messages as settings } from './en-us/settings.js'
import { messages as textTransforms } from './en-us/textTransforms.js'
import { messages as logs } from './en-us/logs.js'
import { messages as notifications } from './en-us/notifications.js'
import { messages as search } from './en-us/search.js'
import type { zhCN } from './zh-cn.js'

export const enUS = {
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
