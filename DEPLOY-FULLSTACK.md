# 全栈部署清单（激活企业微信机器人对接）

> 目标：让 `POST https://shanghaitrade.cn/openapi/auto-import/leads` 真实存在，
> 使 sticky beans 机器人扒完地图后能自动把线索导入系统。
> 当前 GitHub Pages 是纯静态站，没有后端，该接口返回 405 —— 必须先做本清单。

## 0. 前置条件

- Node.js ≥ 18（建议 20 LTS）、PostgreSQL ≥ 13
- 一台公网可访问的服务器（云主机 / Render / Railway / Fly.io 等均可）
- 一个域名 A 记录控制权（`shanghaitrade.cn`，当前指向 GitHub Pages）

## 1. 数据库初始化

```bash
createdb bizinvite                       # 或云厂商控制台建库
psql "$SUDA_DATABASE_URL" -f scripts/schema.sql
```

`scripts/schema.sql` 已含全部 8 张表、索引、外键和平台复合类型
（`user_profile` / `file_attachment`）。

**额外一步（必须）**：平台的数据库中间件会按请求切换角色，需创建三个角色并授权：

```sql
CREATE ROLE anon_ NOLOGIN;
CREATE ROLE authenticated_ NOLOGIN;
CREATE ROLE service_role_ NOLOGIN;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon_, authenticated_, service_role_;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon_, authenticated_, service_role_;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon_, authenticated_, service_role_;
```

## 2. 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `SUDA_DATABASE_URL` | ✅ | Postgres 连接串，如 `postgres://user:pass@host:5432/bizinvite` |
| `JWT_SECRET` | ✅ | 登录令牌签名密钥，用长随机字符串（不设则用内置 dev 值，生产必须改） |
| `FORCE_AUTHN_INNERAPI_DOMAIN` | ✅ | 平台 HTTP 客户端要求的基础域名，填你的站点地址即可（如 `https://shanghaitrade.cn`） |
| `FORCE_AUTHN_ACCESS_KEY` / `FORCE_AUTHN_ACCESS_SECRET` | ○ | 占位即可（本地验证用任意字符串） |
| `SERVER_HOST` / `SERVER_PORT` | ○ | 默认 `localhost:3000`；公网部署设 `0.0.0.0` + 端口 |
| `NODE_ENV` | ○ | `production` |

## 3. 构建与启动

```bash
npm install                 # 注意：不要用 npm ci，lockfile 与 package.json 未同步
npm run build:server        # nest build（swc）；若本机缺 swc 原生绑定，用下面的 tsc 替代
npm run build:client        # vite build，产出 dist/client

# swc 不可用时（如 macOS + lockfile 只锁 linux 绑定）：
node node_modules/typescript/bin/tsc -p tsconfig.node.json

# 启动（在项目根目录）
SUDA_DATABASE_URL="..." JWT_SECRET="..." FORCE_AUTHN_INNERAPI_DOMAIN="https://shanghaitrade.cn" \
  node scripts/run-selfhosted.js
```

`scripts/run-selfhosted.js` 负责在运行时注册 `@server/*` / `@shared/*` 路径别名
（tsc 产物不重写 require 路径）。进程守护可用 systemd / pm2 / docker，监听 `SERVER_PORT`。

## 4. 域名切换

1. 服务器就绪后，把 `shanghaitrade.cn` 的 A 记录从 GitHub Pages IP
   （`185.199.108–111.153`）改为服务器 IP；`www` 保持 CNAME 到 apex 或一并改 A 记录。
2. **Cloudflare 代理保持关闭（灰云）**，否则证书和回源都会出问题。
3. 在服务器上配 HTTPS（Caddy / Nginx + certbot 均可，反代到 `SERVER_PORT`）。
4. 回滚方式：把 A 记录改回 GitHub Pages IP 即可（静态站随时可用）。

## 5. 部署后验证（按顺序）

```bash
# 1) 注册首账号（自动成为 admin）
curl -X POST https://shanghaitrade.cn/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"zijian_lang@chinayytech.com","password":"<8位以上>","displayName":"Zijian Lang"}'

# 2) 登录拿 token
curl -X POST https://shanghaitrade.cn/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"zijian_lang@chinayytech.com","password":"<同一密码>"}'

# 3) 先保存一次模型设置（建 model_config 行，设密钥前必须）
curl -X PATCH https://shanghaitrade.cn/api/model-config \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"apiBaseUrl":"https://api.openai.com/v1","apiKey":"sk-...","modelName":"gpt-4o-mini","senderSignature":"..."}'

# 4) 设置导入密钥（也可在 设置 → 机器人对接 页面点"随机生成→保存密钥"）
curl -X POST https://shanghaitrade.cn/api/settings/import-secret \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"importSecret":"<32位随机串>"}'

# 5) 模拟机器人调用（返回 projectId/projectUrl/imported/duplicates 即通）
curl -X POST https://shanghaitrade.cn/openapi/auto-import/leads \
  -H 'Content-Type: application/json' -H 'X-Import-Secret: <同一密钥>' \
  -d '{"projectName":"测试项目","leads":[{"名称":"Restaurant Aurora","电话":"+381 64 123 4567","邮箱":"info@aurora.rs"}]}'
```

浏览器侧无需关心 CSRF：平台视图中间件会在页面响应里自动种下
`suda-csrf-token` Cookie 并注入 `window.__platform__.csrfToken`，客户端自动带上请求头。

## 6. 配置企业微信 sticky beans 机器人

在机器人的设置里新增一个 HTTP 调用（工具 / 插件 / API，具体菜单取决于机器人平台）：

- 方法：`POST`
- 地址：`https://shanghaitrade.cn/openapi/auto-import/leads`
- 请求头：`Content-Type: application/json`、`X-Import-Secret: <第 5 步的密钥>`
- 请求体：`{"projectName": "<项目名>", "leads": [ {...} ]}`
- 提示词约定：扒完地图 → 整理成 JSON（中英表头混排均可）→ 调该接口 → 把返回的
  `projectUrl` 发给用户 → 用户点开即进入项目工作台。

## 7. 行为约定（已实现，测试确认）

- 无 `名称` 字段的行跳过；按 名称/邮箱/网站 归一化后去重（批内 + 库内）。
- 项目按名称大小写不敏感查找，不存在则自动创建（描述为 `Auto-created by auto-import`）。
- 自动导入创建的项目/线索对 admin 账号可见。
- 密钥错误或未配置 → 401；参数不合法 → 400。

## 8. 本次配套修复（已在本地全链路验证）

1. `bcryptjs` 从 `^3.0.3` 降为 `^2.4.3`：3.x 是 `type: module` 包，其 UMD 入口在
   CJS `require()` 下返回空对象，全栈部署注册/登录必崩（静态站走离线适配器所以从未触发）。
2. `ImportSecretController`（`/api/settings/import-secret`）与 `EmailThreadsController`
   （`/api/email-threads`）从平台 `@NeedLogin()` 改为应用自己的 `JwtAuthGuard`：
   前者依赖平台会话 `userContext`，自建部署下永远 401，机器人对接无法激活；
   后者同时把 `userId` 来源从 `req.userContext` 改为 JWT payload。
3. 新增 `scripts/schema.sql`（建表）、`scripts/run-selfhosted.js`（自托管启动）。

## 9. 已知注意点

- `package-lock.json` 未包含 bcryptjs 条目，与 package.json 不同步；用 `npm install`
  （不要 `npm ci`）刷新，或提交前重新生成 lockfile。
- lockfile 只锁 linux-x64 原生绑定（rolldown/oxide/lightningcss/swc），macOS 构建需
  手动补 darwin-arm64 包；CI 建议用对应平台安装。
- 静态站（GitHub Pages）不受以上服务端改动影响，仍走 offlineAdapter，行为不变。
