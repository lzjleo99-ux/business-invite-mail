/**
 * 平台「妙搭生成」悬浮角标的替身。
 *
 * 背景：`<AppContainer>` 会无条件渲染 `@lark-apaas/client-toolkit` 的 `Watermark`
 * 组件（`lib/components/AppContainer/index.js` 第204 行，紧贴 `SafetyErrorBoundary`
 * 一起挂载），在每一页右下角输出 `data-custom-element="miaoda-watermark"` 的固定定位药丸。
 *
 * 为什么不走官方的 `MIAODA_BUILD_TARGET=standalone` 开关（那是 SDK 唯一提供的关闭方式）：
 * 该开关会让 preset 把产物切成 `file://` 离线形态 —— 输出格式换 iife、剥掉入口
 * `<script>` 的 `type="module"` / `crossorigin`、摘掉 slardar / og-meta / view-context
 * 三个平台注入插件。它服务的是「导出离线包本地打开」这个场景，线上站点用它会白屏。
 *
 * 所以改为在 `vite.config.ts` 里用 `resolveId` 把 `AppContainer/index.js` 对
 * `Watermark.js` 的那一次引用换成本文件。范围精确到「唯一那个引用方+ 唯一那一次
 * 相对导入」，不会波及 SDK 的其它能力：antd `ConfigProvider` 主题/中文 locale、
 * `QueryProvider`、SDK 自带的 `AuthProvider`（我们其实用自己的，见 contexts/AuthContext）
 * 都照常保留 —— Workbench 的表格分页文案仍然需要 `zh_CN` locale。
 *
 * 附带收益：原 `Watermark` 的 `useEffect` 会去打 `tenant_info` / `get_published`
 * 两个平台接口，自建部署下必然 404；不渲染组件，这两个请求一并消失。
 *
 * 注意 `AppContainer` 之外没有别处 import 这个模块（已全量核对 client-toolkit/lib），
 * 所以这是一次性、无副作用的替换。
 */
const NoBrandBadge = () => null;

export default NoBrandBadge;