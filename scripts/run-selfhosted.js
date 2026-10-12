#!/usr/bin/env node
/**
 * 自托管（非 lark-apaas 平台）启动器。
 *
 * 背景：编译产物里的 `require("@server/...")` / `require("@shared/...")` 是
 * tsconfig paths 别名，Node 运行时不认识。平台的 swc 构建会处理别名，用
 * `tsc` 编译时不会，所以这里在运行时注册别名。
 *
 * 实现说明：不依赖 tsconfig-paths（那是 devDependency，部署包里没有），
 * 直接patch Module._resolveFilename —— 只拦截 @server/@shared 前缀的请求，
 * 映射到 dist/ 下的编译产物后交回 Node 原生的扩展名解析。
 *
 * 用法（在项目根目录或部署包根目录执行）：
 *   SUDA_DATABASE_URL="postgres://user:pass@host:5432/dbname" \
 *   JWT_SECRET="<随机长字符串>" \
 *   FORCE_AUTHN_INNERAPI_DOMAIN="https://你的域名" \
 *   node scripts/run-selfhosted.js
 *
 * 其余环境变量见 DEPLOY-FULLSTACK.md / .env.production.template。
 */
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ENTRY = path.join(DIST, 'server', 'main.js');

if (!require('fs').existsSync(ENTRY)) {
  console.error(
    '[run-selfhosted] dist/server/main.js 不存在，请先编译：\n' +
      '  node node_modules/typescript/bin/tsc -p tsconfig.node.json   # 或 npx nest build\n',
  );
  process.exit(1);
}

// 别名 → 编译产物目录
const ALIASES = {
  '@server': path.join(DIST, 'server'),
  '@shared': path.join(DIST, 'shared'),
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (request === alias || request.startsWith(alias + '/')) {
      const mapped = path.join(target, request.slice(alias.length));
      try {
        // 交给原生解析以补全 .js / index.js 等
        return originalResolve.call(this, mapped, parent, isMain, options);
      } catch {
        // 映射失败时继续走原始逻辑，让错误信息保持原样
      }
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require(ENTRY);
