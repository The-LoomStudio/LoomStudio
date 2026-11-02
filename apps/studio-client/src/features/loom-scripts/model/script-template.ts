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
    '---', `id: rule.${crypto.randomUUID()}`, 'name: 新文本规则', 'version: 1.0.0', 'tags: [text]',
    "regex: '待替换文字'", 'regex_flags: g', 'phases: [display]', 'order: 0', 'streaming: false', '---',
    '替换后文字',
  ].join('\n')
}
