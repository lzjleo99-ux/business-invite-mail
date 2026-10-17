import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { enMessages } from './translations';

export type UILang = 'zh' | 'en';

const STORAGE_KEY = 'bd-mail-ui-lang';

/**
 * 应用名（品牌）。浏览器标签页标题 + 侧边栏/顶部都用它；
 * 服务端注入的默认标题（妙搭应用/妙捷应用）会被这里覆盖。
 */
export const APP_NAME_ZH = '邮件收发助手';
export const APP_NAME_EN = 'Email Assistant';

interface I18nContextValue {
  lang: UILang;
  setLang: (lang: UILang) => void;
  toggle: () => void;
  /** Translate a Chinese source string to the current UI language. */
  t: (zh: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLang(): UILang {
  if (typeof window === 'undefined') return 'zh';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    /* ignore */
  }
  const nav = window.navigator?.language || 'zh';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : match,
  );
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<UILang>(detectInitialLang);

  const setLang = useCallback((next: UILang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next === 'en' ? 'en' : 'zh';
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setLang(lang === 'en' ? 'zh' : 'en');
  }, [lang, setLang]);

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh';
    document.title = lang === 'en' ? APP_NAME_EN : APP_NAME_ZH;

    // 平台服务端渲染会把 index.html 里的 <link rel="icon" href="/favicon.svg">
    // 改写成空 href（实测线上就是 <link rel="icon" href="">），浏览器因此拿不到
    // logo。客户端兜底：删掉空 href 的 icon 链接，再挂上自己的 favicon。
    document.querySelectorAll('link[rel~="icon"]').forEach((el) => {
      if (!el.getAttribute('href')) el.remove();
    });
    if (!document.querySelector('link[rel="icon"][href="/favicon.svg"]')) {
      const icon = document.createElement('link');
      icon.setAttribute('rel', 'icon');
      icon.setAttribute('href', '/favicon.svg');
      document.head.appendChild(icon);
    }
  }, [lang]);

  const t = useCallback(
    (zh: string, vars?: Record<string, string | number>) => {
      if (lang === 'zh' || !zh) return interpolate(zh, vars);
      const hit = enMessages[zh];
      return interpolate(hit ?? zh, vars);
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, toggle, t }), [
    lang,
    setLang,
    toggle,
    t,
  ]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Graceful fallback if a component is rendered outside the provider.
    return {
      lang: 'zh',
      setLang: () => undefined,
      toggle: () => undefined,
      t: (zh: string) => zh,
    };
  }
  return ctx;
}

/** Convenience hook that returns only the translator. */
export function useT() {
  return useI18n().t;
}
