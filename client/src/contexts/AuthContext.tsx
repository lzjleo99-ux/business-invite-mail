import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { AuthUser } from '@shared/api.interface';
import * as authApi from '@/api/auth';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

/**
 * 存储降级链：localStorage → sessionStorage → 内存。
 * 某些浏览器/隐私模式会禁掉 localStorage（Safari「阻止所有 Cookie」、
 * 严格隐私扩展），此时 setItem 直接抛错——原来会被 catch 吞掉、登录态
 * 完全不留痕，用户表现为"登录成功但刷新就又回登录页"。至少要让当前
 * 会话可用，并给出可感知的降级。
 */
const authStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = (() => {
  const probe = (s: Storage | undefined): s is Storage => {
    try {
      if (!s) return false;
      s.setItem('__auth_probe__', '1');
      s.removeItem('__auth_probe__');
      return true;
    } catch {
      return false;
    }
  };
  if (probe(window.localStorage)) return window.localStorage;
  if (probe(window.sessionStorage)) {
    logger.warn('localStorage 不可用，登录态降级为 sessionStorage（仅当前标签页有效）');
    return window.sessionStorage;
  }
  logger.warn('localStorage/sessionStorage 均不可用，登录态仅保留在内存中');
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  };
})();

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // The request interceptor is registered once and reads the current token
  // from this ref. React runs child effects (page data fetching) before the
  // provider's own effect, so an interceptor re-registered on every token
  // change would let the very first request after login/register go out
  // without an Authorization header -- the API answers 401 and the user is
  // bounced straight back to /login.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    try {
      const storedToken = authStorage.getItem(TOKEN_KEY);
      const storedUser = authStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser) as AuthUser);
        // 本地这份只是登录时的快照。角色/显示名在服务端改了（比如被提升为
        // 超级管理员），不同步的话界面会一直显示旧角色——侧边栏徽章还是
        // 「Admin」，而用户管理页（读接口）已经显示「Super admin」，两边不一致。
        // 这里静默刷新一次；失败不影响使用，下次登录自然更正。
        void authApi
          .getMe(storedToken)
          .then((fresh) => {
            if (!fresh) return;
            setUser((prev) => {
              if (
                prev &&
                prev.id === fresh.id &&
                prev.role === fresh.role &&
                prev.displayName === fresh.displayName
              ) {
                return prev;
              }
              authStorage.setItem(USER_KEY, JSON.stringify(fresh));
              return fresh;
            });
          })
          .catch(() => undefined);
      }
    } catch (err) {
      logger.warn('Failed to read auth from localStorage', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveAuth = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    queryClient.clear();
    try {
      authStorage.setItem(TOKEN_KEY, newToken);
      authStorage.setItem(USER_KEY, JSON.stringify(newUser));
    } catch (err) {
      logger.warn('Failed to save auth to localStorage', err);
    }
  }, [queryClient]);

  const clearAuth = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.clear();
    try {
      authStorage.removeItem(TOKEN_KEY);
      authStorage.removeItem(USER_KEY);
    } catch (err) {
      logger.warn('Failed to clear auth from localStorage', err);
    }
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login({ email, password });
      saveAuth(result.token, result.user);
    },
    [saveAuth],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const result = await authApi.register({ email, password, displayName });
      saveAuth(result.token, result.user);
    },
    [saveAuth],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      logger.warn('Logout API call failed', err);
    }
    clearAuth();
  }, [clearAuth]);

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      await authApi.changePassword({ oldPassword, newPassword });
    },
    [],
  );

  useEffect(() => {
    const requestInterceptor = axiosForBackend.interceptors.request.use(
      (config) => {
        const currentToken =
          tokenRef.current ??
          (() => {
            try {
              return authStorage.getItem(TOKEN_KEY);
            } catch {
              return null;
            }
          })();
        if (currentToken && config.headers) {
          config.headers.Authorization = `Bearer ${currentToken}`;
        }
        // CSRF 头兜底：平台拦截器读 window.csrfToken，这里再从 cookie 取一次，
        // 保证 DELETE/PATCH 等请求一定带头（漏头会被网关 403，表现为"删除失败"）
        if (config.headers) {
          const winToken = (window as unknown as { csrfToken?: string }).csrfToken;
          const cookieToken = document.cookie
            .split(';')
            .map((c) => c.trim())
            .find((c) => c.startsWith('suda-csrf-token='))
            ?.split('=')[1];
          const csrf = winToken || cookieToken;
          if (csrf) config.headers['X-Suda-Csrf-Token'] = csrf;
        }
        return config;
      },
    );

    const responseInterceptor = axiosForBackend.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          clearAuth();
          navigate('/login');
        }
        return Promise.reject(error);
      },
    );

    return () => {
      axiosForBackend.interceptors.request.eject(requestInterceptor);
      axiosForBackend.interceptors.response.eject(responseInterceptor);
    };
  }, [clearAuth, navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isLoading, login, register, logout, changePassword }),
    [user, token, isLoading, login, register, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
