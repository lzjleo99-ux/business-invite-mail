import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { setupErrorTranslation } from './server-messages';

// 服务端报错是中文文案，英文界面用户看不懂。
// 在唯一的 axios 实例上挂一个响应拦截器，把高频报错翻译成当前界面语言，
// 所有调用点的 err.message 自动变成英文（见 server-messages.ts）。
setupErrorTranslation(axiosForBackend);

export * as restaurants from './restaurants';
export * as projects from './projects';
export * as modelConfig from './model-config';
export * as websiteAnalyzer from './website-analyzer';
export * as emailGenerator from './email-generator';
export * as emailThreads from './email-threads';
export * as senderConfig from './sender-config';
export * as auth from './auth';
export * as admin from './admin';
