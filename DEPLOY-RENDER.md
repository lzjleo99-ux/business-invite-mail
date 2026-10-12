# 备用上线路线：Render + Neon（免信用卡，约 30 分钟）

> Oracle 注册风控过不去时的备选。**不需要信用卡**，全部免费层。
> 代价：服务 15 分钟无请求会休眠（机器人闲置后的第一笔调用要等约 1 分钟）。
> 接口契约与机器人配置仍见 `DEPLOY-FULLSTACK.md`；Oracle 路线见 `DEPLOY-ORACLE.md`。

## 1. 建数据库（Neon，5 分钟）

1. 打开 https://neon.com ，用 GitHub/Google 登录（免费，不绑卡）。
2. Create project → 区域选 **AWS Europe (Frankfurt)** 或离你近的区域。
3. 在 Connection details 里复制连接串，形如
   `postgres://neondb_owner:xxxx@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. **在你电脑上初始化表结构和角色**（仓库目录里执行）：
   ```bash
   cd /Users/leolang/WorkBuddy/2026-10-12-02-56-23/business-invite-mail
   node scripts/init-db.js "postgres://neondb_owner:xxxx@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require"
   ```
   看到 `当前表（8）` 和 `角色就绪` 即成功（脚本幂等，可重复跑）。

## 2. 部署应用（Render，15 分钟）

1. 打开 https://render.com ，用 GitHub 登录（免费，不绑卡）。
2. New → **Blueprint** → 授权访问 `lzjleo99-ux/business-invite-mail` 仓库 →
   Render 读取 `deploy/render/render.yaml` 自动创建服务。
3. 在服务页面补两个环境变量（Blueprint 里标记为 sync: false）：
   - `SUDA_DATABASE_URL` = 第 1 步的 Neon 连接串
   - `FORCE_AUTHN_INNERAPI_DOMAIN` = `https://shanghaitrade.cn`
4. Manual Deploy → Deploy latest commit。构建约 5-10 分钟（要装依赖 + 构建前后端）。
5. 部署完成后 Render 会给你一个 `https://bizinvite-xxxx.onrender.com` 临时域名，
   先打开确认能看到登录页。

## 3. 绑域名（5 分钟）

Render 服务页 → Settings → Custom Domains → 添加 `shanghaitrade.cn` 和
`www.shanghaitrade.cn`，Render 会显示要填的 DNS 记录（apex 用 A 记录、www 用 CNAME）。

到 Cloudflare（dash.cloudflare.com → shanghaitrade.cn → DNS，**代理保持灰云**）：
- 按 Render 显示的值添加/修改 `@` 和 `www` 记录（原 GitHub Pages IP: 185.199.108-111.153）
- Render 会自动签发并续期 Let's Encrypt 证书，等几分钟变 Ready。

## 4. 验证与激活

```bash
curl https://shanghaitrade.cn/        # 200 即通
```
然后按 `DEPLOY-FULLSTACK.md` 第 5 节：注册账号 → 浏览器登录 → 设置里保存一次模型配置 →
机器人对接设导入密钥 → 模拟机器人调用 `/openapi/auto-import/leads` 验证 → 配进 sticky beans。

## 5. 这条路的特性与注意

| 项 | 说明 |
|---|---|
| 休眠 | 15 分钟无请求服务休眠，下次请求冷启 30-60 秒。可接受；介意的话用 cron-job.org 每 10 分钟 ping 一次 `/` 保活（免费） |
| 数据库 | Neon 免费层 1GB 存储、100 CU-小时/月；计算空闲 5 分钟自动挂起，首条查询慢几百毫秒 |
| 数据安全 | Neon 不会删库（区别于 Render 自带免费 PG 的 30 天过期，所以别用 Render 的库） |
| 备份 | 每周 `pg_dump` 拉到本地：`pg_dump "<Neon连接串>" > backup.sql` |
| 回滚 | Cloudflare 把 `@`/`www` 改回 GitHub Pages IP 即可 |

## 6. 升级

推送代码到 GitHub main 分支 → Render 自动重新构建部署（autoDeploy 已开）。
数据库结构有变更时，在你电脑上重跑一次 `node scripts/init-db.js "<Neon连接串>"`。
