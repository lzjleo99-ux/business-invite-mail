import { logger } from '@lark-apaas/client-toolkit/logger';
// 注意：这个 barrel **没有被任何地方引用**（各页面直接 import '@/api/xxx'），
// 所以 axios 拦截器不能挂在这里——那是死代码。已挂在 src/index.tsx 入口。
export { setupErrorTranslation } from './server-messages';

export * as restaurants from './restaurants';
export * as projects from './projects';
export * as modelConfig from './model-config';
export * as websiteAnalyzer from './website-analyzer';
export * as emailGenerator from './email-generator';
export * as emailThreads from './email-threads';
export * as senderConfig from './sender-config';
export * as auth from './auth';
export * as admin from './admin';
