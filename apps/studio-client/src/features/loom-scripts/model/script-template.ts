export function createScriptTemplate(): string {
  return [
    '// ==LoomScript==',
    '// @format 1',
    `// @id script.${crypto.randomUUID()}`,
    '// @name 新脚本',
    '// @version 1.0.0',
    '// @runtime client',
    '// ==/LoomScript==',
    '',
    'export function activate(ctx) {',
    "  ctx.logger.info('脚本已启动')",
    '}',
    '',
  ].join('\n')
}
