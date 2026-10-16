# business-invite-mail 全栈容器镜像
# 适用：Google Cloud Run / Northflank / Fly.io / 任何容器主机。
# 多阶段构建：阶段一装齐依赖并构建前后端，裁剪到仅生产依赖；
# 阶段二只带产物运行，镜像约 300-400MB。
#
# 注意：用 `npm install` 而非 `npm ci`——仓库 lockfile 与 package.json 未同步
# （缺 bcryptjs 条目），npm ci 会直接失败。

# ---------- 构建阶段 ----------
FROM node:20-bookworm AS build
WORKDIR /app

# 先拷贝依赖清单，利用 Docker 层缓存
# --ignore-scripts：跳过生命周期钩子——package.json 的 postinstall 调用平台专用的
# `fullstack-cli`（不在依赖里，任何自建容器都不存在），exit 127 直接弄挂构建。
# 原生二进制（@swc/core/rolldown/oxide 等）走 optionalDependencies 平台包，不需要脚本。
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund --ignore-scripts

# 构建：服务端（nest/swc，linux-x64 原生绑定在容器内正常下载）+ 客户端（vite）
COPY . .
RUN npm run build:server && npm run build:client

# 构建完成后裁掉 devDependencies，缩小运行时体积
# （lockfile 与 package.json 不同步时 prune 可能告警，失败也不阻断——只是镜像大一点）
RUN npm prune --omit=dev || echo "npm prune 告警，保留全部依赖继续构建"

# ---------- 运行阶段 ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json

# 功能依赖的运行时二进制（node:*-slim 都不带这些，缺了整个功能静默失败）：
# - python3 + openpyxl/pypdf：Excel 导入与项目资料 PDF/表格解析（服务端 spawn python3）
# 注意：不再装 chromium——实测 Northflank 沙箱会拦截渲染器进程所需的 syscall，
# 浏览器能启动（--version 正常）但产不出任何输出（dump-dom 空、截图文件不生成），
# 属于平台级限制；网站分析改走 HTTP 直取（已覆盖绝大多数服务端渲染的企业站点）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-openpyxl python3-pypdf2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p logs

# Cloud Run 约定注入 PORT=8080；Northflank 等在平台侧设置 SERVER_HOST/PORT
ENV PORT=8080
EXPOSE 8080

# 健康检查用（Cloud Run / Northflank 都会探测 /）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/run-selfhosted.js"]
