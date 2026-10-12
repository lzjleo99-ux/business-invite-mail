#!/usr/bin/env bash
# 制作自包含部署包：构建 + 仅生产依赖 + 一键初始化脚本，打成单个 tar.gz。
#
# 为什么这样做：目标机是 Oracle ARM（aarch64）VM。仓库 lockfile 只锁了
# linux-x64 原生绑定，在 ARM 上现装原生依赖容易踩坑；而运行时依赖全是纯 JS
# （postgres/bcryptjs/jsonwebtoken/nest...），构建产物与平台无关。所以在
# 本地构建打包、VM 上直接解压运行，最稳。
#
# 用法：  ./scripts/build-bundle.sh
# 产物：  dist-bundle/bizinvite-<时间戳>.tar.gz （含 sha256）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE_NAME="bizinvite-$STAMP"
OUT_DIR="$ROOT_DIR/dist-bundle"
STAGE="$OUT_DIR/stage"

echo "==> [1/6] 清理暂存区"
rm -rf "$STAGE"
mkdir -p "$STAGE/$BUNDLE_NAME"

echo "==> [2/6] 编译服务端（tsc；nest build 需要 swc 原生绑定，本机不可用时用 tsc）"
# NODE_OPTIONS="" 去掉沙箱预载的 node shim：vite/rolldown 写大量文件时经 broker IPC
# 管道会偶发 EPIPE 把构建崩掉（本地现象，与代码无关）。
if NODE_OPTIONS="" node node_modules/typescript/bin/tsc -p tsconfig.node.json 2>/tmp/bundle-tsc.log; then
  echo "    tsc 完成"
else
  echo "!! tsc 失败，见 /tmp/bundle-tsc.log"; tail -20 /tmp/bundle-tsc.log; exit 1
fi

echo "==> [3/6] 构建客户端（vite）"
if NODE_OPTIONS="" NODE_ENV=production node node_modules/vite/bin/vite.js build --config vite.config.ts >/tmp/bundle-vite.log 2>&1; then
  echo "    vite build 完成"
else
  echo "!! vite build 失败，见 /tmp/bundle-vite.log"; tail -20 /tmp/bundle-vite.log; exit 1
fi

echo "==> [4/6] 收集生产依赖（npm ls --omit=dev，共 $(npm ls --omit=dev --parseable --all 2>/dev/null | grep -c node_modules) 个包）"
# 注意：lockfile 与 package.json 不同步时 npm ls 会以 ELSPROBLEMS 非零退出，
# 但输出列表仍然完整，这里容忍退出码，只校验列表非空。
npm ls --omit=dev --parseable --all 2>/dev/null | grep node_modules | sort -u \
  | sed "s#^$ROOT_DIR/##" > /tmp/prod-paths.txt || true
[[ -s /tmp/prod-paths.txt ]] || { echo "!! 生产依赖列表为空"; exit 1; }
# 注意：--files-from 下 -a 不会递归，必须显式 -r（-l 保留软链）；
# --files-from 隐含 --relative，列表里是 node_modules/xxx，所以目标要写到包根，
# 不能再拼一层 node_modules，否则会变成 node_modules/node_modules/xxx。
rsync -rltp --files-from=/tmp/prod-paths.txt ./ "$STAGE/$BUNDLE_NAME/"
# 校验：不应有悬空软链（macOS 的 find 无 -xtype，用 test -e 逐条判断）
DANGLING="$(find "$STAGE/$BUNDLE_NAME/node_modules" -type l | while read -r l; do [ -e "$l" ] || echo "$l"; done)"
if [[ -n "$DANGLING" ]]; then
  echo "!! 存在悬空软链："; echo "$DANGLING" | head -5; exit 1
fi
echo "    已复制 $(find "$STAGE/$BUNDLE_NAME/node_modules" -type f | wc -l | tr -d ' ') 个文件"
# 结构自检：关键运行时依赖必须直接在包内 node_modules 下（防嵌套错位）
for pkg in @nestjs/core express drizzle-orm postgres bcryptjs jsonwebtoken hbs; do
  [[ -d "$STAGE/$BUNDLE_NAME/node_modules/$pkg" ]] || { echo "!! 缺少运行时依赖: $pkg"; exit 1; }
done
echo "    结构自检通过（@nestjs/core / express / drizzle-orm / postgres / bcryptjs / jsonwebtoken / hbs）"

echo "==> [5/6] 组装包内容"
mkdir -p "$STAGE/$BUNDLE_NAME/scripts" "$STAGE/$BUNDLE_NAME/deploy/oracle" "$STAGE/$BUNDLE_NAME/dist"
cp -R dist/server dist/shared dist/client "$STAGE/$BUNDLE_NAME/dist/"
cp package.json "$STAGE/$BUNDLE_NAME/"
cp scripts/run-selfhosted.js scripts/schema.sql "$STAGE/$BUNDLE_NAME/scripts/"
cp deploy/oracle/bootstrap.sh deploy/oracle/bizinvite.service deploy/oracle/Caddyfile "$STAGE/$BUNDLE_NAME/deploy/oracle/"
cp .env.production.template "$STAGE/$BUNDLE_NAME/" 2>/dev/null || cat > "$STAGE/$BUNDLE_NAME/.env.production.template" <<'EOF'
# 部署时由 bootstrap.sh 据此生成 .env（也可手动改）
SUDA_DATABASE_URL=postgres://bizinvite:<密码>@127.0.0.1:5432/bizinvite
JWT_SECRET=<长随机字符串>
FORCE_AUTHN_INNERAPI_DOMAIN=https://<你的域名>
FORCE_AUTHN_ACCESS_KEY=local
FORCE_AUTHN_ACCESS_SECRET=local
SERVER_HOST=127.0.0.1
SERVER_PORT=3000
NODE_ENV=production
EOF
chmod +x "$STAGE/$BUNDLE_NAME/deploy/oracle/bootstrap.sh"

echo "==> [6/6] 打包"
mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/$BUNDLE_NAME.tar.gz" -C "$STAGE" "$BUNDLE_NAME"
shasum -a 256 "$OUT_DIR/$BUNDLE_NAME.tar.gz" | tee "$OUT_DIR/$BUNDLE_NAME.tar.gz.sha256"
SIZE="$(du -h "$OUT_DIR/$BUNDLE_NAME.tar.gz" | cut -f1)"
echo ""
echo "✅ 部署包生成: $OUT_DIR/$BUNDLE_NAME.tar.gz ($SIZE)"
echo "   上传到 VM 后:  tar -xzf $BUNDLE_NAME.tar.gz && cd $BUNDLE_NAME && sudo ./deploy/oracle/bootstrap.sh"
