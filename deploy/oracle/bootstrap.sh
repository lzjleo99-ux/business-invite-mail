#!/usr/bin/env bash
# =============================================================================
# business-invite-mail —— Oracle Cloud Always Free 一键初始化
#
# 在 VM 上以 root（或 sudo）执行，位于解压后的部署包目录内：
#   sudo ./deploy/oracle/bootstrap.sh
#
# 会自动完成：安装 Node 20 / PostgreSQL 16 / Caddy → 建库建表建角色 →
#             安装应用至 /opt/bizinvite → 生成 .env → systemd 守护 →
#             Caddy 反代 + 自动 HTTPS → 放行本机防火墙。
# 可重复执行（幂等）。
#
# 可用环境变量预填（不填则交互询问）：
#   DOMAIN=shanghaitrade.cn DB_PASSWORD=xxx JWT_SECRET=xxx ./deploy/oracle/bootstrap.sh
# =============================================================================
set -euo pipefail

APP_DIR=/opt/bizinvite
SERVICE=bizinvite
DOMAIN="${DOMAIN:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
JWT_SECRET="${JWT_SECRET:-}"

log() { echo -e "\n\033[1;32m==> $1\033[0m"; }
warn() { echo -e "\n\033[1;33m!! $1\033[0m"; }

[[ $EUID -eq 0 ]] || { echo "请用 root 执行（或 sudo）"; exit 1; }
[[ -f "$(pwd)/dist/server/main.js" ]] || { echo "请在解压后的部署包目录内执行"; exit 1; }

# ---------- 0. 交互收集参数 ----------
if [[ -z "$DOMAIN" ]]; then read -r -p "域名（如 shanghaitrade.cn）: " DOMAIN; fi
if [[ -z "$DB_PASSWORD" ]]; then read -r -s -p "数据库密码（留空则自动生成）: " DB_PASSWORD; echo; fi
[[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 16)"
if [[ -z "$JWT_SECRET" ]]; then read -r -s -p "JWT 密钥（留空则自动生成）: " JWT_SECRET; echo; fi
[[ -n "$JWT_SECRET" ]] || JWT_SECRET="$(openssl rand -hex 32)"

# ---------- 1. 识别系统 ----------
if [[ -f /etc/os-release ]]; then . /etc/os-release; else echo "无法识别系统"; exit 1; }
log "系统: $PRETTY_NAME ($(uname -m))"

# ---------- 2. 安装 Node 20 ----------
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v20" ]]; then
  log "安装 Node.js 20"
  if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif [[ "$ID" == "ol" || "$ID" == "rhel" || "$ID" == "fedora" ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  else
    echo "未知发行版，请手动安装 Node 20"; exit 1
  fi
fi
node -v; npm -v

# ---------- 3. 安装 PostgreSQL 16 ----------
if ! command -v psql >/dev/null; then
  log "安装 PostgreSQL 16"
  if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
    apt-get install -y postgresql postgresql-contrib
  elif [[ "$ID" == "ol" || "$ID" == "rhel" || "$ID" == "fedora" ]]; then
    dnf install -y postgresql-server postgresql-contrib
    [[ -f /var/lib/pgsql/data/PG_VERSION ]] || postgresql-setup --initdb
  fi
fi
systemctl enable --now postgresql

# ---------- 4. 建库 / 建用户 / 建表 / 建角色 ----------
log "初始化数据库"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='bizinvite'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER bizinvite WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='bizinvite'" | grep -q 1 \
  || sudo -u postgres createdb -O bizinvite bizinvite

export PGPASSWORD="$DB_PASSWORD"
psql -h 127.0.0.1 -U bizinvite -d bizinvite -v ON_ERROR_STOP=1 -f "$(pwd)/scripts/schema.sql"
# 平台中间件按请求切换角色，三个角色必须存在并授权
psql -h 127.0.0.1 -U bizinvite -d bizinvite -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  CREATE ROLE anon_ NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated_ NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role_ NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon_, authenticated_, service_role_;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon_, authenticated_, service_role_;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon_, authenticated_, service_role_;
SQL
unset PGPASSWORD

# ---------- 5. 安装应用 ----------
log "安装应用到 $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude 'node_modules/.bin' \
  ./dist ./node_modules ./scripts ./package.json "$APP_DIR/"
cat > "$APP_DIR/.env" <<EOF
SUDA_DATABASE_URL=postgres://bizinvite:${DB_PASSWORD}@127.0.0.1:5432/bizinvite
JWT_SECRET=${JWT_SECRET}
FORCE_AUTHN_INNERAPI_DOMAIN=https://${DOMAIN}
FORCE_AUTHN_ACCESS_KEY=local
FORCE_AUTHN_ACCESS_SECRET=local
SERVER_HOST=127.0.0.1
SERVER_PORT=3000
NODE_ENV=production
EOF
chmod 600 "$APP_DIR/.env"
mkdir -p "$APP_DIR/logs"

# ---------- 6. systemd 守护 ----------
log "配置 systemd 服务"
cp "$(pwd)/deploy/oracle/bizinvite.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 3
systemctl --no-pager --lines=5 status "$SERVICE" || true

# ---------- 7. Caddy 反代 + 自动 HTTPS ----------
if ! command -v caddy >/dev/null; then
  log "安装 Caddy"
  if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update && apt-get install -y caddy
  else
    dnf install -y 'dnf-command(copr)' && dnf copr enable -y @caddy/caddy && dnf install -y caddy
  fi
fi
sed "s/__DOMAIN__/$DOMAIN/g" "$(pwd)/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy || true

# ---------- 8. 本机防火墙 ----------
log "放行 80/443（OCI 安全列表还需在网页控制台放行，见下方提示）"
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --add-service=http --add-service=https || true
  firewall-cmd --reload || true
fi
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80  -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent || true
    netfilter-persistent save || true
  else
    iptables-save > /etc/sysconfig/iptables 2>/dev/null || true
  fi
fi

# ---------- 9. 摘要 ----------
PUB_IP="$(curl -s --max-time 5 https://api.ipify.org || echo '<VM公网IP>')"
cat <<EOF

$(log "完成！接下来只剩两步（都需要你本人在网页操作）")

第 1 步 · 开放 OCI 安全列表（网页控制台，脚本无法代做）
   OCI 控制台 → 网络 → 虚拟云网络 → 你的 VCN → 子网 → 安全列表 → 添加入站规则：
     - 源 0.0.0.0/0  TCP  80
     - 源 0.0.0.0/0  TCP  443

第 2 步 · 切换域名 DNS（Cloudflare，代理保持灰云）
   $DOMAIN  A 记录  $PUB_IP     （原 GitHub Pages IP: 185.199.108.153 等）

第 3 步 · 等 DNS 生效后验证（约 1-5 分钟）
   curl https://$DOMAIN/                                   # 应返回 200
   curl -X POST https://$DOMAIN/api/auth/register -H 'Content-Type: application/json' \\
        -d '{"email":"zijian_lang@chinayytech.com","password":"<8位以上>","displayName":"Zijian Lang"}'
   # 登录 → 设置 → 机器人对接 → 设导入密钥 → 按 DEPLOY-FULLSTACK.md 第 5 节验证自动导入

回滚：把 DNS 改回 GitHub Pages IP 即可，静态站随时可用。

EOF
