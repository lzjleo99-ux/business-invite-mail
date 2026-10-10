import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@client/src/components/ui/tooltip';
import { Toaster } from '@client/src/components/ui/sonner';

import RoutesComponent from '@client/src/app';
import { I18nProvider } from '@client/src/i18n';

import '@client/src/index.css';

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter basename={routerBasename}>
            <RoutesComponent />
          </BrowserRouter>
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
);
