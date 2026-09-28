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
