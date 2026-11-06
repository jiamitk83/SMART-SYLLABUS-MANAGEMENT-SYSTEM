import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuth, type AuthUser } from '@/store/auth';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:5000', withCredentials: true, headers: { 'X-Requested-With': 'ssms' } });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

export async function refreshSession(): Promise<string | null> {
  refreshing ??= api
    .post<{ accessToken: string; user: AuthUser }>('/auth/refresh', undefined, { _skipRefresh: true } as object)
    .then((r) => {
      useAuth.getState().setSession(r.data.user, r.data.accessToken);
      return r.data.accessToken;
    })
    .catch(() => {
      useAuth.getState().setSession(null, null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Retryable = InternalAxiosRequestConfig & { _retried?: boolean; _skipRefresh?: boolean };

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg = error.config as Retryable | undefined;
    const isAuthCall = cfg?.url?.startsWith('/auth/login') || cfg?.url?.startsWith('/auth/refresh');
    if (error.response?.status === 401 && cfg && !cfg._retried && !cfg._skipRefresh && !isAuthCall) {
      cfg._retried = true;
      const token = await refreshSession();
      if (token) {
        cfg.headers.Authorization = `Bearer ${token}`;
        return api(cfg);
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const e = err.response?.data as { error?: { message?: string; details?: Array<{ path: string; message: string }> } } | undefined;
    const d = e?.error?.details;
    if (d?.length) return d.map((x) => (x.path ? `${x.path}: ${x.message}` : x.message)).join('; ');
    return e?.error?.message ?? err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}
