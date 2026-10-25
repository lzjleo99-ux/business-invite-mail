/**
 * 机器人项目代码：生成、回填、按代码查项目。
 *
 * 为什么站点侧要有代码：机器人（企微粘豆包）导入线索时，站点接口原本只按
 * projectName 精确匹配——名字打错一个字母就静默推错地方或新建项目。
 * 代码是站点自动生成的唯一短码（FF1357 这种），机器人拿到后回传，
 * 站点按代码定位，定位不到就明确报错，绝不猜。
 *
 * 代码规则：2 位大写字母 + 4 位数字（FF1357 风格），全局唯一，
 * 碰撞重试（26*26*10000 ≈ 676 万组合，实际远不会撞）。
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 生成一个候选代码（不保证唯一，调用方负责碰撞重试） */
export function generateProjectCode(): string {
  let code = '';
  for (let i = 0; i < 2; i += 1) {
    code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }
  for (let i = 0; i < 4; i += 1) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

/** 规范化用户/机器人传来的代码：去空白、转大写、去常见包裹符 */
export function normalizeProjectCode(raw: string | null | undefined): string {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/^[#【\[(（]+/, '')
    .replace(/[#】\])）]+$/, '');
}

export function isValidProjectCode(code: string): boolean {
  return /^[A-Z]{2}\d{4}$/.test(code);
}
