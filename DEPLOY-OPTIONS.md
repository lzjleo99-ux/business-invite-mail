# 上线途径总览与决策（2026-10-13 核实）

> 目标始终一个：让 `POST https://shanghaitrade.cn/openapi/auto-import/leads` 真实存在，
> 企业微信 sticky beans 机器人能调用。接口契约见 `DEPLOY-FULLSTACK.md`。

## 决策表

| 途径 | 费用 | 休眠/冷启 | 数据库 | 信用卡 | 状态 |
|---|---|---|---|---|---|
| **Northflank 免费沙箱** | 永久免费 | **常驻不休眠** | 自带免费 PG（管理员权限，可建角色/复合类型） | 要（仅验证） | ⭐ **推荐** |
| **Google Cloud Run** | 永久免费额度内 | 缩零到零，冷启 ~1.2s | 配 Neon | 要（计费账户） | 备选 |
| Render + Neon | 永久免费 | 15 分钟休眠，冷启 30-60s | Neon（免卡） | **不要** | ✅ 手册已备好 |
| Oracle Always Free | 永久免费 | 常驻 | 自建 PG | 要 | ⚠️ 注册被风控拒 |
| 自己 Mac + Cloudflare Tunnel | 0 元 | 取决于电脑是否开机 | 本机 PG | 不要 | 应急/自用 |
| 香港轻量云（腾讯/阿里） | ¥70-200/年 | 常驻 | 自建或云数据库 | 要 | 最稳但不是免费 |

---

## 途径 A：Northflank 免费沙箱（推荐，常驻不休眠）

免费额度：**2 个服务 + 1 个数据库 + 2 个定时任务，always-on 不休眠**，自定义域名 + 免费 SSL，
从 GitHub 仓库直接部署。注册只需信用卡验证（不扣费）。

**步骤：**

1. 注册 https://app.northflank.com/signup （GitHub 登录），按提示加付款方式。
2. Create project → 区域选 **europe-west**（离塞尔维亚近）。
3. **Addons → Create addon → PostgreSQL**（版本 16）：
   -  Networking 勾选 **Deploy with TLS** 和 **Publicly accessible**（这样你电脑上的
      `init-db.js` 能连上去建表）；
   -  创建后在 Connection details 里复制 **`_ADMIN` 结尾的管理员连接串**
      （普通用户连接串权限不够建角色）。
4. **在你电脑上建表建角色**：
   ```bash
   cd /Users/leolang/WorkBuddy/2026-10-12-02-56-23/business-invite-mail
   node scripts/init-db.js "<_ADMIN连接串>"
   ```
   看到 `当前表（8）` + `角色就绪` 即成功。
5. **Create service → Deploy from GitHub**：选 `lzjleo99-ux/business-invite-mail`，
   构建方式选 **Dockerfile**（仓库根目录已准备好，多阶段构建，自动裁掉开发依赖）。
6. 服务环境变量（Variables）：
   | 键 | 值 |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SERVER_HOST` | `0.0.0.0` |
   | `SERVER_PORT` | 与 Ports 里配的容器端口一致（例：容器端口配 80 就填 80） |
   | `SUDA_DATABASE_URL` | 第 3 步的 `_ADMIN` 连接串 |
   | `JWT_SECRET` | 随机长字符串 |
   | `FORCE_AUTHN_INNERAPI_DOMAIN` | `https://shanghaitrade.cn` |
   | `FORCE_AUTHN_ACCESS_KEY` / `FORCE_AUTHN_ACCESS_SECRET` | 任意占位 |
7. Ports 里把容器端口设为公开；**Networking → Custom domains** 添加
   `shanghaitrade.cn` 和 `www.shanghaitrade.cn`，按提示在 Cloudflare 配 CNAME/A
   （**代理保持灰云**）。SSL 自动。
8. 验证：`curl https://shanghaitrade.cn/` → 200；然后按 `DEPLOY-FULLSTACK.md` 第 5 节
   注册 → 设密钥 → 模拟机器人调用。

> 注意：Northflank 官方称免费沙箱「不应用于生产」。对本工具（低频、单人+机器人）够用；
> 将来业务量上来再升级付费（最小付费 $2.7/月）。

## 途径 B：Google Cloud Run（备选，冷启 ~1.2 秒）

永久免费额度：200 万请求/月、18 万 vCPU-秒、36 万 GiB-秒、1GB 北美出站——本应用远低于限额。
需绑定信用卡开通计费账户（额度内不收费，建议设 $5 预算提醒）。

**步骤：**

1. console.cloud.google.com 建项目 → 开通 Cloud Run + Artifact Registry + Cloud Build。
2. 数据库用 Neon（按 `DEPLOY-RENDER.md` 第 1 节建库，并在你电脑上跑
   `node scripts/init-db.js "<Neon连接串>"`）。
3. 用 Cloud Build 从仓库构建并部署（仓库根目录有 Dockerfile）：
   ```bash
   gcloud run deploy bizinvite \
     --source . --region europe-west1 \
     --allow-unauthenticated --memory 512Mi --min-instances 0 \
     --set-env-vars NODE_ENV=production,SERVER_HOST=0.0.0.0,SERVER_PORT=8080 \
     --set-env-vars SUDA_DATABASE_URL='<Neon连接串>' \
     --set-env-vars JWT_SECRET='<随机串>' \
     --set-env-vars FORCE_AUTHN_INNERAPI_DOMAIN=https://shanghaitrade.cn
   ```
4. Cloud Run 服务页 → Custom domains → 添加 `shanghaitrade.cn`，按提示在 Cloudflare 配
   A/CNAME（灰云）。Google 自动签证书。
5. 验证同途径 A 第 8 步。

## 途径 C：Render + Neon（免信用卡，已备好）

见 `DEPLOY-RENDER.md`。唯一代价是 15 分钟无请求休眠、机器人闲置后第一笔调用等约 1 分钟
（可用 cron-job.org 每 10 分钟 ping 一次 `/` 保活）。

## 途径 D：Oracle Always Free（注册被卡）

手册在 `DEPLOY-ORACLE.md`，部署包 `dist-bundle/bizinvite-*.tar.gz` 已打好并通过解压验收。
当前卡在注册风控（IP 在塞尔维亚 + 国内卡片）。重试要点：账单地址与卡一致、隔 24 小时、
无痕+禁扩展；或点「与 Oracle 客户服务联系」人工审核。

## 途径 E：自己 Mac + Cloudflare Tunnel（0 元、0 注册）

适合：有一台常年不关机的 Mac/迷你主机，想完全免费、不依赖任何第三方平台。

1. 本机装 PostgreSQL（`brew install postgresql@16`），`createdb bizinvite`，
   然后 `node scripts/init-db.js "postgres://postgres@localhost:5432/bizinvite"`。
2. 本机起服务：`SUDA_DATABASE_URL=... JWT_SECRET=... FORCE_AUTHN_INNERAPI_DOMAIN=https://shanghaitrade.cn node scripts/run-selfhosted.js`
   （设为开机启动：launchd plist 或 `caffeinate` 防睡眠）。
3. `brew install cloudflared && cloudflared tunnel login && cloudflared tunnel create bizinvite`
4  把 `shanghaitrade.cn` CNAME 到 `<隧道ID>.cfargotunnel.com`（**Cloudflare 必须开橙云代理**，
  这与 GitHub Pages 的灰云要求相反——Tunnel 靠 Cloudflare 边缘进出）。
5. `cloudflared tunnel run bizinvite` 配成 launchd 守护。

缺点：电脑关机/睡眠就下线，家庭带宽上行有限，无 SLA。适合自用工具，不适合当唯一生产环境。

## 途径 F：香港轻量云（最稳，非免费）

腾讯云轻量应用服务器「中国香港」区域 2C2G/30Mbps 约 ¥100-200/年起；阿里云轻量香港类似。
**香港/海外服务器无需 ICP 备案**（这是选它而不是国内区域的原因），国内访问和企业微信回调
延迟都低。到手后按 `DEPLOY-ORACLE.md` 第 3 节之后的步骤操作（脚本通用：Node/PG/Caddy 都会装）。
