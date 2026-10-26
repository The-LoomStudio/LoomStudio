export function createScriptTemplate(): string {
  return [
    '// ==LoomScript==',
    '// @format 1',
    `// @id script.${crypto.randomUUID()}`,
    '// @name 新脚本',
    '// @version 1.0.0',
    '// @runtime client',
    '// @tag utility',
    '// @setting {"key":"message","label":"启动消息","description":"脚本启动时写入日志的文字","type":"string","default":"脚本已启动"}',
    '// ==/LoomScript==',
    '',
    'export function activate(ctx) {',
    '  ctx.logger.info(ctx.scriptSettings.message)',
    '}',
    '',
  ].join('\n')
}

export function createTextRuleScriptTemplate(): string {
  return [
    '// ==LoomScript==',
    '// @format 1',
    `// @id rule.${crypto.randomUUID()}`,
    '// @name 新文本规则',
    '// @version 1.0.0',
    '// @runtime declarative',
    '// @tag text',
    '// @setting {"key":"replacement","label":"替换文字","type":"string","default":"替换后文字"}',
    '// @contribution {',
    '//   "kind": "text-transform", "id": "replace",',
    '//   "rule": {',
    '//     "name": "替换示例", "enabled": true, "orderIndex": 0,',
    '//     "matcher": {"kind":"regex", "pattern":"待替换文字", "flags":"g"},',
    '//     "effect": {"kind":"replace", "replacement":{"$config":"replacement"}},',
    '//     "targets": ["narrative", "agent-session"], "phases": ["display"]',
    '//   }',
    '// }',
    '// ==/LoomScript==',
    '',
  ].join('\n')
}
