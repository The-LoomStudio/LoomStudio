// ==LoomScript==
// @format 1
// @id example.configurable-text-rule
// @name 可配置的旁白名称
// @version 1.0.0
// @runtime declarative
// @tag regex
// @tag ui
// 作者在这里声明可配置项；使用者在平台的“配置”中填写，不需要修改源码。
// @setting {
//   "key": "narratorName",
//   "label": "旁白名称",
//   "description": "将正文中的 [narrator] 显示为这个名称。保存配置后点击刷新生效。",
//   "type": "string",
//   "default": "旁白"
// }
// @contribution {
//   "kind": "text-transform",
//   "id": "narrator-name",
//   "rule": {
//     "name": "替换旁白名称",
//     "enabled": true,
//     "orderIndex": 0,
//     "matcher": { "kind": "regex", "pattern": "\\[narrator\\]", "flags": "g" },
//     "effect": { "kind": "replace", "replacement": { "$config": "narratorName" } },
//     "targets": ["narrative", "agent-session"],
//     "phases": ["display"]
//   }
// }
// ==/LoomScript==
