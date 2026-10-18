import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

const NO_BRAND_BADGE = path.resolve(__dirname, 'client/src/components/brand/NoBrandBadge.tsx');

/**
 * 把平台 `AppContainer` 里的「妙搭生成」悬浮角标换成空组件。
 *
 * 角标来自 `@lark-apaas/client-toolkit` 的 `lib/components/AppContainer/Watermark.js`，
 * 由 `AppContainer/index.js` 无条件渲染在每一页右下角。本项目自建部署、不在妙搭平台上
 * 运营，这个入口没有意义，用户要求去掉。
 *
 * 用 `resolveId` 而不是 `resolve.alias`：alias 只能按「包名/路径前缀」替换整块模块，
 * 而这里要换的是 AppContainer **内部那一次具体的相对导入** `./Watermark.js`，
 * 所以必须在 resolveId 里按 importer 精确匹配。只认这一个 importer + 这一条 specifier，
 * 换SDK 版本时若路径变化则静默失效（角标会回来，不会弄挂站点）。
 *
 * 没有采用官方 `MIAODA_BUILD_TARGET=standalone`：那个开关会把产物切到 `file://` 离线
 * 形态（输出换 iife、剥掉入口 script 的 type="module"），线上用会白屏。
 */
function dropBrandBadge(): Plugin {
  return {
    name: 'drop-miaoda-brand-badge',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== './Watermark.js') return null;
      if (!importer?.endsWith('client-toolkit/lib/components/AppContainer/index.js')) return null;
      return NO_BRAND_BADGE;
    },
  };
}

const APP_TITLE = '邮件收发助手';

/**
 * 把 HTML 壳里的标题占位符 `{{appName}}` 换成真实应用名。
 *
 * 平台构建把标题留成 `<title>{{appName}}</title>`，由平台在**响应时**注入 appName。
 * 自建部署没有在平台后台运营应用，注入的是平台默认名「妙搭应用」，于是用户每次刷新
 * 都会先看到浏览器标签页写着「妙搭应用」，等 JS 跑完才跳走（甚至不跳）。
 *
 * 这里在**构建期**就把标题/og:title 里的占位符替换成字面量，平台就找不到占位符、
 * 也就不会再注入，标签页从第一帧就是正确的。og:title / og:description 一并处理，
 * 免得分享出去的链接预览也写着「妙搭应用」。
 */
function setAppTitle(): Plugin {
  return {
    name: 'set-app-title',
    // post：平台的 vite preset 自己也会 transformIndexHtml 并注入 {{appName}} 占位符，
    // 必须排在它之后跑，才能把占位符替换掉（pre 会被平台覆盖回去）。
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<title>\s*\{\{appName\}\}\s*<\/title>/gi, `<title>${APP_TITLE}</title>`)
        .replace(
          /(<meta[^>]+property=["']og:title["'][^>]*content=["'])\s*\{\{appName\}\}\s*(["'])/gi,
          `$1${APP_TITLE}$2`,
        );
    },
  };
}

export default defineConfig({
  plugins: [dropBrandBadge(), setAppTitle()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});