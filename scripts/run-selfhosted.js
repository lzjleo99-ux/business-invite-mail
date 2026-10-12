#!/usr/bin/env node
/**
 * 自托管（非 lark-apaas 平台）启动器。
 *
 * 背景：编译产物里的 `require("@server/...")` / `require("@shared/...")` 是
 * tsconfig paths 别名，Node 运行时不认识。平台的 swc 构建会处理别名，本地用
 * `tsc -p tsconfig.node.json` 编译时不会，所以用这个启动器在运行时注册别名。
 *
 * 用法（在项目根目录执行）：
 *   SUDA_DATABASE_URL="postgres://user:pass@host:5432/dbname" \
 *   JWT_SECRET="<随机长字符串>" \
 *   FORCE_AUTHN_INNERAPI_DOMAIN="https://你的域名" \
 *   node scripts/run-selfhosted.js
 *
 * 可选环境变量见 DEPLOY-FULLSTACK.md。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

if (!require('fs').existsSync(path.join(DIST, 'server', 'main.js'))) {
  console.error(
    '[run-selfhosted] dist/server/main.js 不存在，请先编译：\n' +
      '  node node_modules/typescript/bin/tsc -p tsconfig.node.json   # 或 npx nest build\n',
  );
  process.exit(1);
}

// 别名指向编译产物（dist/server/*、dist/shared/*）
require('tsconfig-paths').register({
  baseUrl: ROOT,
  paths: {
    '@server/*': ['dist/server/*'],
    '@shared/*': ['dist/shared/*'],
  },
});

require(path.join(DIST, 'server', 'main.js'));
