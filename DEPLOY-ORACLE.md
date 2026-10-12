# Oracle Cloud Always Free 上线手册（企业微信机器人对接激活）

> 目标：把全栈应用部署到 Oracle 永久免费 VPS，让
> `POST https://shanghaitrade.cn/openapi/auto-import/leads` 真实存在，机器人可调用。
> 通用接口契约见 `DEPLOY-FULLSTACK.md`，本手册只讲 Oracle 这条路的操作步骤。

## 0. 总览：已备好的 vs 需要你本人做的

| 步骤 | 状态 |
|---|---|
| 部署包（构建产物 + 生产依赖 + 初始化脚本，80MB） | ✅ 已生成在 `dist-bundle/bizinvite-*.tar.gz` |
| VM 一键初始化脚本（Node/Postgres/Caddy/systemd/防火墙） | ✅ `deploy/oracle/bootstrap.sh` |
| 部署包本地验收（解压直跑，全链路通过） | ✅ 已完成 |
| 注册 Oracle 账号（邮箱+信用卡验证） | ⬜ 需你本人 |
| 创建 ARM VM | ⬜ 需你本人（脚本无法代做） |
| 上传部署包并执行 bootstrap | ⬜ 你复制粘贴 3 条命令 |
| OCI 安全列表放行 80/443 | ⬜ 需你本人（网页控制台） |
| 切换 Cloudflare DNS | ⬜ 需你本人 |
| 验证 + 配机器人 | ⬜ 按第 5 节 |

## 1. 注册 Oracle Cloud（约 10 分钟）

1. 打开 https://oracle.com/cloud/free ，点 Start for free，用邮箱注册。
2. 验证邮箱后填写信用卡信息（**仅身份验证，不扣费**；Always Free 额度内永久免费）。
   - 虚拟卡/预付卡不接受，需普通信用卡或可用信用卡。
3. 注册后选择 Home Region（**建议 Japan East (Tokyo) 或 South Korea (Chuncheon)**：
   离国内近、ARM 机型相对有容量、服务器在海外无需备案）。

> 注册被拒是常见现象（风控），换网络环境/换张卡/过几小时再试即可，不影响最终使用。

## 2. 创建 ARM 虚拟机（约 3 分钟）

OCI 控制台 → 计算 → 实例 → 创建实例：

| 配置项 | 选法 |
|---|---|
| 镜像 | Oracle Linux 9（或 Ubuntu 24.04，脚本两者都支持） |
| 形状 | Ampere (Arm) — **VM.Standard.A1.Flex**，OCPU 选 2（2026 年 8 月起免费额度为 2 核 12GB；若控制台仍允许 4 核也可，以 Limits 页为准） |
| 内存 | 12 GB |
| 启动卷 | 默认（占用 200GB 免费块存储额度） |
| SSH 密钥 | 上传你的公钥（`cat ~/.ssh/id_rsa.pub`，没有就 `ssh-keygen` 生成一个） |

创建后记录 **公网 IP**。

> 若报 "Out of host capacity"：换可用区 (AD-1/AD-2) 或稍后重试；热门区域常态。

## 3. 上传部署包并初始化（3 条命令）

```bash
# 在你电脑上执行（把 <VM公网IP> 换成真实 IP）
cd /Users/leolang/WorkBuddy/2026-10-12-02-56-23/business-invite-mail
scp dist-bundle/bizinvite-*.tar.gz opc@<VM公网IP>:~/        # Oracle Linux 用 opc；Ubuntu 用 ubuntu

# SSH 登录 VM 后执行（Oracle Linux）
ssh opc@<VM公网IP>
tar -xzf bizinvite-*.tar.gz && cd bizinvite-*/ && sudo ./deploy/oracle/bootstrap.sh
```

bootstrap 会交互询问 3 个值（也可用环境变量预填）：

- **域名**：`shanghaitrade.cn`
- **数据库密码**：回车则自动生成
- **JWT 密钥**：回车则自动生成

它会自动完成：装 Node 20 / PostgreSQL 16 / Caddy → 建库建表建角色 → 装应用到
`/opt/bizinvite` → 生成 `.env` → systemd 守护进程 → Caddy 反代 + 自动 HTTPS → 放行本机防火墙。
完成后屏幕会打印你的 VM 公网 IP 和后续两步提示。

> 重复执行安全（幂等）。升级方式：本地重新 `./scripts/build-bundle.sh` → scp 新包 →
> VM 上解压到新目录再跑一次 bootstrap（或直接 rsync 覆盖 dist/ 后 `systemctl restart bizinvite`）。

## 4. 两个必须你本人在网页做的操作

**① OCI 安全列表放行端口**（控制台 → 网络 → 虚拟云网络 → 子网 → 安全列表 → 添加入站规则）：

| 源 | 协议 | 端口 |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**② Cloudflare 切换 DNS**（dash.cloudflare.com → shanghaitrade.cn → DNS，**代理保持灰云**）：

| 类型 | 名称 | 内容 |
|---|---|---|
| A | `@` | `<VM公网IP>`（原值 185.199.108.153 等 GitHub Pages IP 记下来备用） |
| A | `www` | `<VM公网IP>` |

## 5. 验证与激活

```bash
# 1) 站点（DNS 生效后，约 1-5 分钟；Caddy 自动签证书需再等 1-2 分钟）
curl https://shanghaitrade.cn/                      # 200 即通

# 2) 注册账号（首账号为 admin；密码必须 ≥8 位含字母数字）
curl -X POST https://shanghaitrade.cn/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"zijian_lang@chinayytech.com","password":"<8位以上>","displayName":"Zijian Lang"}'

# 3) 登录 → 浏览器打开 https://shanghaitrade.cn → 设置 → 模型设置 保存一次
#    （建 model_config 行，设密钥的前置条件）→ 机器人对接 → 随机生成 → 保存密钥

# 4) 模拟机器人调用（把 <密钥> 换成第 3 步的）
curl -X POST https://shanghaitrade.cn/openapi/auto-import/leads \
  -H 'Content-Type: application/json' -H 'X-Import-Secret: <密钥>' \
  -d '{"projectName":"塞尔维亚餐厅拓展","leads":[{"名称":"Restaurant Aurora","电话":"+381 64 123 4567","邮箱":"info@aurora.rs"}]}'
# 期望：{"projectId":"...","projectUrl":"/projects/...","imported":1,"duplicates":0}
```

然后把 `https://shanghaitrade.cn/openapi/auto-import/leads` 和同一个密钥配进
企业微信 sticky beans 机器人的 HTTP 调用里（提示词约定见 `DEPLOY-FULLSTACK.md` 第 6 节）。

## 6. 运维速查

```bash
systemctl status bizinvite          # 应用状态
journalctl -u bizinvite -f          # 实时日志（或看 /opt/bizinvite/logs/app.log）
systemctl restart bizinvite         # 重启
sudo -u postgres psql bizinvite     # 进数据库
caddy validate --config /etc/caddy/Caddyfile   # 检查反代配置
```

## 7. 回滚

Cloudflare 把 `@`/`www` 的 A 记录改回 GitHub Pages IP（`185.199.108.153` /
`185.199.109.153` / `185.199.110.153` / `185.199.111.153`）即可，静态站随时可用，
VM 上的数据原样保留，之后想切回来只要再改 DNS。

## 8. 注意事项

- **费用红线**：只在 Always Free 额度内使用（2 OCPU/12GB、200GB 存储、10TB/月流量）。
  创建付费形状或超量会产生费用；不确定时先在 Limits, Quotas and Usage 页看已用量。
- **数据备份**：免费层无自动备份。建议每周 `pg_dump` 拉到本地或对象存储
  （`sudo -u postgres pg_dump bizinvite > backup.sql`）。
- **ARM 容量**：VM 被回收后重开可能遇到 Out of capacity，换可用区重试。
- **证书**：Caddy 自动申请续期 Let's Encrypt；证书域名为 `shanghaitrade.cn` + `www`。
