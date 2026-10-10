import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  AuthUser,
  ChangePasswordRequest,
} from '@shared/api.interface';

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await axiosForBackend.post('/api/auth/register', data);
  return response.data;
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await axiosForBackend.post('/api/auth/login', data);
  return response.data;
}

export async function getMe(token: string): Promise<AuthUser> {
  const response = await axiosForBackend.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

export async function logout(): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/auth/logout');
  return response.data;
}

export async function changePassword(
  data: ChangePasswordRequest,
): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/auth/change-password', data);
  return response.data;
}
