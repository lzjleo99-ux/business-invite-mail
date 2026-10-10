import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  useEffect(() => {
    try {
      const storedToken = window.localStorage.getItem(TOKEN_KEY);
      const storedUser = window.localStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser) as AuthUser);
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
      window.localStorage.setItem(TOKEN_KEY, newToken);
      window.localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    } catch (err) {
      logger.warn('Failed to save auth to localStorage', err);
    }
  }, [queryClient]);

  const clearAuth = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.clear();
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
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
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
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
  }, [token, clearAuth, navigate]);

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
