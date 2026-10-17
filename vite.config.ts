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

export default defineConfig({
  plugins: [dropBrandBadge()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});