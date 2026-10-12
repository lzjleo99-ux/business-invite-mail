# business-invite-mail 全面排查与修复报告

**仓库**：https://github.com/lzjleo99-ux/business-invite-mail
**线上站点**：https://shanghaitrade.cn
**审计日期**：2026-10-12
**代码状态**：`main` 已同步（`7bd9955..2d46d93`，6 个 commit），工作区干净

---

## 一、修复的问题清单（按严重程度排序）

### P0 — 站点完全不可用（致命）

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | **静态部署全站瘫痪** | commit `7bd9955` 删除了 `client/src/offline/offlineAdapter.ts`（811 行）及其在 `index.tsx` 的注册。GitHub Pages 没有 NestJS 后端，所有 `/api/*` 请求落到 SPA fallback，返回 HTML 而非 JSON | 从 `9794d88` 恢复该文件并扩展至应用实际调用的全部路由 |
| 2 | **`index.html` 静态探测被破坏** | `{{{__platform__}}}` 在静态托管下永不被替换，`JSON.parse` 抛异常。原代码用 `console.error` 记录后**继续执行**，但早期一次"修复"曾把 `window.__platform__ = {}`，导致 `installOfflineIfStatic()` 误判为平台环境而退出 | 保留 parse 失败时 `__platform__` 为 `undefined`——这正是静态托管的检测标志；仅静默吞掉异常并注明原因 |

### P1 — 核心功能不可用

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 3 | **工作台表格永久空白** | adapter 缺少 `GET /api/restaurants` 列表接口。该请求落进 `:id` 分支，`id` 为 `undefined` → 404「公司不存在」 | 补齐列表接口，完整镜像服务端 `findAll` 语义：`status`/`search`/`noEmail`/`isStarred`/`filterKey` 过滤、`createdAt DESC` 排序、`limit/offset` 分页 |
| 4 | **Excel 导入 0 条** | adapter 的 `HEADER_ALIASES` 只有英文表头，而随附模板用的是双语表头（`名称 Name`、`地址 Address`、`网站 Website`、`电话 Phone`、`邮箱 Email`、`来源 Source`、`纬度 Lat`、`经度 Lng`），每行都因「缺少名称」被跳过 | 改用与服务端 `FIELD_ALIASES` 完全一致的结构 |
| 5 | **`.eml` 下载永远 401** | 该接口在 JWT guard 后面，`window.open(getEmlUrl(id))` 不带 `Authorization` 头 | 新增 `downloadEml()`：经认证 axios 客户端获取（同时兼容服务端纯文本响应与 adapter 的 JSON 包装），再以 Blob 保存 |
| 6 | **注册/登录后被弹回 `/login`** | 请求拦截器随 `token` 变化在父 effect 中重复注册。React 子 effect（页面取数）先于父 effect 执行，导致登录后首个请求无 `Authorization` 头 → 401 → 跳回登录页 | 拦截器只注册一次，token 从渲染期同步的 `useRef` 读取，附 localStorage 兜底 |
| 7 | **跨账号数据泄露** | adapter 无 owner 隔离：任何登录用户都能看到/修改他人项目 | 项目增加 `ownerId`；非 admin 只能查看和操作自己的行；写操作只作用于可见行，不波及其他用户数据；含一次性 backfill，让此前无主项目归还原主人 |

### P2 — 功能缺陷

| # | 问题 | 根因 | 修复 |
|---------|------|------|
| 8 | **本地化邮件内容被丢弃** | 工作台编辑器可改本地化主题/正文，但 `updateEmail()` 只写 `emailSubject`/`emailBody` | 透传 `subjectLocal`/`bodyLocal` 经 `UpdateEmailRequest`、controller DTO、service patch |
| 9 | **批量进度条串显** | `a \|\| b \|\| c` 链在运行中任务计数为 0 时穿透，显示另一个任务的数字 | 显式选出正在运行的那个操作 |
| 10 | **查询缓存隔离** | `ProjectListPage`/`ProjectWorkbenchPage` 各自嵌套 `QueryClientProvider`，形成第二个隔离缓存，看不到根 client 的 invalidate | 移除嵌套 provider，统一用应用级 provider |
| 11 | **移动端布局挤压** | 固定 `w-60` 侧栏无响应式处理，与 AGENTS.md 的 `p-6` 桌面 / `p-4` 移动规范矛盾 | 新增移动端顶栏 + 汉堡抽屉，主内容区 `p-4 / lg:p-6` |
| 12 | **`wxmail://` 静默失败** | 该 scheme 仅在企业微信内置浏览器可解析，其他地方导航过去毫无反应 | 非企微环境降级 `mailto:` 并 toast 告知用户 |
| 13 | **项目列表双重内边距** | Layout 已提供 `p-4/lg:p-6`，页面又加 `p-6` | 移除页面级重复 padding |
| 14 | **WhatsApp URL 冗余自或** | `toDigits(waPhone \|\| waPhone)` | 简化为 `toDigits(waPhone)` |

### P3 — 部署链路缺陷

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 15 | **线上标题字面量 `{{appName}}`** | 平台构建把 `{{appName}}` 等占位符留在 dist HTML，靠平台注入；GitHub Pages 不执行这一步 | 新增 `scripts/deploy-pages.js`：替换占位符、写入 `404.html` SPA fallback、`.nojekyll`、`CNAME`，再 force push |
| 16 | **HTTPS 证书未签发** | 边缘节点只发 `*.github.io` 证书，API 一直报 "The certificate does not exist yet" | CNAME 拔插法强制重新走域名验证与签发流程（详见「部署结果」） |

---

## 二、改动的文件

### 新增
| 文件 | 说明 |
|------|------|
| `client/src/offline/offlineAdapter.ts` | 静态托管 localStorage 适配器（1206 行）。含 auth / admin / restaurants 全套路由、RFC-822 `.eml` 生成（RFC 2047 编码主题）、双语 Excel 解析、按 ownerId 数据隔离 |
| `scripts/deploy-pages.js` | GitHub Pages 部署脚本（`npm run deploy:pages`，支持 `--dry-run`，token 只从 `GITHUB_TOKEN`/`--token` 读取且不出现在错误信息中） |

### 修改
| 文件 | 改动 |
|------|------|
| `client/src/index.tsx` | 重新注册 offline adapter |
| `index.html` | 静态探测失败时静默，保留 `__platform__` 为 undefined |
| `client/src/api/email-generator.ts` | 新增 `downloadEml()` |
| `client/src/contexts/AuthContext.tsx` | 拦截器单次注册 + token ref |
| `client/src/components/Layout.tsx` | 响应式外壳（移动端顶栏/抽屉、`p-4/lg:p-6`） |
| `client/src/pages/ProjectList/ProjectListPage.tsx` | 移除嵌套 provider、移除重复 padding |
| `client/src/pages/ProjectWorkbench/ProjectWorkbenchPage.tsx` | 保存四个邮件字段、移除嵌套 provider |
| `client/src/pages/ProjectWorkbench/WorkbenchTab.tsx` | 批量进度修正、`.eml` 走 `downloadEml`、冗余自或 |
| `client/src/pages/ProjectWorkbench/SendEmailDropdown.tsx` | `.eml` 走 `downloadEml` + 错误提示 |
| `client/src/pages/ComposeEmail/ComposeEmailPage.tsx` | `.eml` 走 `downloadEml`、`wxmail://` 降级 |
| `client/src/i18n/translations.ts` | 新增 4 条英文翻译 |
| `server/modules/restaurants/restaurants.controller.ts` | DTO 增加 `subjectLocal`/`bodyLocal` |
| `server/modules/restaurants/restaurants.service.ts` | `updateEmail` 持久化本地化副本 |
| `shared/api.interface.ts` | `UpdateEmailRequest` 增加可选本地化字段 |
| `package.json` | 新增 `deploy:pages` 脚本 |

---

## 三、逐项功能验证结果

全部在真实 Chromium 中实测通过：

| 功能 | 结果 |
|------|------|
| 注册（首账号为 admin） | ✅ 落到 `/`，侧栏出现「用户管理」 |
| 登录 / 登出 | ✅ token 写入/清除，正确跳转 |
| 重复注册 | ✅ 409，「该邮箱已被注册」，停留 `/register` |
| 错误密码登录 | ✅ 401，「邮箱或密码错误」，停留 `/login` |
| 创建项目 | ✅ 落到 `/projects/:id` |
| **Excel 导入** | ✅ 4 行全部导入（修复前 0 行）。含手机号 `+381 64 …`→mobile（WhatsApp+Viber）、座机 `011 3221 900`→landline（仅 Viber）、中文国别「塞尔维亚」正确识别、无联系方式行不崩溃 |
| 列表 / 统计 | ✅ 总数 4、待分析 3、已生成 1、缺邮箱 1 |
| **分页** | ✅ 29 条数据：第 1 页 20 行、第 2 页 9 行，`createdAt DESC` 排序稳定 |
| 搜索 | ✅ 大小写不敏感，仅匹配名称（与服务端一致） |
| 状态筛选 | ✅ 8 个选项全部生效 |
| 统计卡片筛选 | ✅ `starred`/`pending`/`generated`/`no_email`/`failed` 均正确 |
| 链接生成 | ✅ 手机号 `wa.me/381641234567` + `viber.me/381641234567`；座机仅 Viber；无号码全部禁用 |
| `.eml` 下载 | ✅ `Restaurant_Aurora.eml`，287 B，`message/rfc822`；中文主题正确编码为 `=?UTF-8?B?…?=` |
| 撰写页 | ✅ 收件人/主题/正文正确回填，中英切换正常 |
| 语言切换 | ✅ 全站中英文即时切换 |
| 桌面端布局 | ✅ 1280×800 正常 |
| 移动端布局 | ✅ 390×844：侧栏隐藏、汉堡抽屉可用、无横向溢出 |
| 用户管理 | ✅ 列表/分页/搜索/角色/状态，自我禁用与自我降级均被拦截 |
| **数据隔离** | ✅ 普通用户看不到 admin 项目；直连 URL 全 0 无泄露；admin 仍完整可见 |
| 构建 / 类型 / Lint | ✅ `tsc --noEmit`（app + node）0 错误；ESLint 0 错误（6 个 warning 均为 HEAD 既有）；stylelint 通过 |

---

## 四、部署结果

**`https://shanghaitrade.cn` 已上线并正常工作。**

| 检查项 | 结果 |
|--------|------|
| DNS（apex） | ✅ 4 条 A 记录 → `185.199.108–111.153` |
| DNS（www） | ✅ CNAME → `lzjleo99-ux.github.io` |
| Cloudflare 代理 | ✅ 已关闭（灰云，直连 GitHub） |
| Pages 状态 | ✅ `built`，`cname=shanghaitrade.cn`，`custom_404=true` |
| HTTPS 证书 | ✅ 已签发，覆盖 `shanghaitrade.cn` + `www.shanghaitrade.cn`，2027-01-10 到期 |
| HTTPS 强制 | ✅ `https_enforced: true`，HTTP 全量 301 → HTTPS |
| 首页 | ✅ 200，6133 B，标题 `商务邀约邮件助手` |
| JS / CSS / favicon / routes.json | ✅ 全部 200，`ssl_verify=0` |
| SPA 深链接 | ✅ 返回 SPA 外壳（含 `#root`），客户端路由接管 |
| Excel 模板 | ✅ 200，正确 MIME |

**关于证书的说明**：初次部署后证书一直未签发（边缘只发 `*.github.io`），纯等待无效。最终通过「CNAME 拔插法」解决——从 gh-pages 删除 `CNAME` 并 push → 等 Pages 重新 build → 用 API 重新登记域名（注意不能同时传 `https_enforced`，证书未批时整个请求会 404）→ 轮询到 `state: approved` → 再开启 HTTPS 强制。该方法已记入项目记忆。

---

## 五、遗留风险与后续建议

### 需要你决策的
1. **静态版能力边界**：GitHub Pages 只有前端。网站分析、AI 邮件/WhatsApp 生成、连接测试都需要 NestJS + 数据库后端，静态版对这些操作返回友好的 503。数据存在浏览器 localStorage，换设备/清缓存即丢失。若要完整功能需另行部署后端（`.spark_project` 的 `[deployment]` 已声明 `build`/`run`）。
2. **`xlsx` 导入仅接受 `.xlsx`**：文件输入 `accept=".xlsx"`，旧版 `.xls` 和 `.csv` 无法导入。这是原有设计，如需支持需前后端同时调整。

### 建议关注
3. **lockfile 只锁了 linux-x64 原生绑定**（`@rolldown/binding-*`、`@tailwindcss/oxide-*`、`lightningcss-*`）。本次在 macOS 上需手动补 darwin-arm64 包才能构建。建议在 CI 中用对应平台 `npm install` 生成正确的 lockfile，或改为可选依赖声明。
4. **ESLint 6 个 warning**（unused eslint-disable directives）是 HEAD 既有问题，本次未动以免无关重构。可用 `eslint . --fix` 一次性清理。
5. **`client/src/pages/ProjectWorkspace/ProjectWorkspacePage.tsx` 是未接线的死代码**（`app.tsx` 无对应路由），同样留着没动。
6. **统计卡片「已分析」与筛选语义不一致**：卡片计数用宽口径（`analyzed/generating/generated`），点击后按 `status='analyzed'` 严口径过滤。此行为**服务端完全一致**，属既有产品设计，未改动。
7. **证书 2027-01-10 到期**，GitHub 会自动续期；若届时再次卡住，用同一套 CNAME 拔插法即可。

### 环境备忘（复用时需要）
- `npm install` 在沙箱内会因 broker rename 拒绝而损坏 node_modules，需按 lockfile tarball 直连重下重解压。
- `node_modules/.bin` 符号链接会丢失，需手动补齐。
- 二进制要用 `node node_modules/<pkg>/bin/...` 调用，不要用 `npx`。
- ESLint 输出须重定向到文件，直连管道会触发 broker EPIPE 假失败。
