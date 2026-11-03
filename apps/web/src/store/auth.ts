import { create } from 'zustand';
import type { Permission, Role } from '@ssms/shared';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  permissions: Permission[];
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  ready: boolean;
  setSession: (user: AuthUser | null, accessToken: string | null) => void;
  setReady: () => void;
  can: (p: Permission) => boolean;
}

/** Access token lives only in memory; the refresh token is an httpOnly cookie. */
export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  ready: false,
  setSession: (user, accessToken) => set({ user, accessToken }),
  setReady: () => set({ ready: true }),
  can: (p) => get().user?.permissions.includes(p) ?? false,
}));
