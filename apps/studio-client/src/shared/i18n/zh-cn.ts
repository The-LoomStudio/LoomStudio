import { messages as extensionsFlow } from './zh-cn/extensions-flow.js'
import { messages as extensionReview } from './zh-cn/extension-review.js'
import { messages as observation } from './zh-cn/observation.js'
import { messages as userProfile } from './zh-cn/user-profile.js'
import { messages as common } from './zh-cn/common.js'
import { messages as sessions } from './zh-cn/sessions.js'
import { messages as agent } from './zh-cn/agent.js'
import { messages as resources } from './zh-cn/resources.js'
import { messages as characters } from './zh-cn/characters.js'
import { messages as state } from './zh-cn/state.js'
import { messages as prompt } from './zh-cn/prompt.js'
import { messages as extensions } from './zh-cn/extensions.js'
import { messages as settings } from './zh-cn/settings.js'
import { messages as textTransforms } from './zh-cn/textTransforms.js'
import { messages as logs } from './zh-cn/logs.js'
import { messages as notifications } from './zh-cn/notifications.js'
import { messages as search } from './zh-cn/search.js'

export const zhCN = {
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
  ...extensionsFlow,
  ...extensionReview,
  ...settings,
  ...textTransforms,
  ...logs,
  ...notifications,
  ...search,
} as const
