import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@client/src/components/ui/tooltip';
import { Toaster } from '@client/src/components/ui/sonner';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';

import RoutesComponent from '@client/src/app';
import { I18nProvider, useI18n } from '@client/src/i18n';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { installOfflineIfStatic } from '@client/src/offline/offlineAdapter';

import '@client/src/index.css';

// On static hosting (GitHub Pages) there is no NestJS backend; install a
// localStorage-backed adapter so the app stays fully interactive. It is a
// no-op when running inside the real platform runtime.
installOfflineIfStatic(axiosForBackend);

// Vite injects BASE_URL from the configured `base` (defaults to '/').
// For a GitHub project page build we set base=/<repo>/ and derive the
// router basename from it so client-side routing resolves correctly.
const routerBasename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * antd 组件自带的文案（分页的"共 x 条 / 第 x 页"、日期、空状态等）不受我们的 t() 管，
 * 只认 ConfigProvider 的 locale。不包这层的话，英文界面里表格分页永远是中文。
 */
const AntdLocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang } = useI18n();
  return <ConfigProvider locale={lang === 'en' ? enUS : zhCN}>{children}</ConfigProvider>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <AntdLocaleProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter basename={routerBasename}>
            <RoutesComponent />
          </BrowserRouter>
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
      </AntdLocaleProvider>
    </I18nProvider>
  </React.StrictMode>,
);
