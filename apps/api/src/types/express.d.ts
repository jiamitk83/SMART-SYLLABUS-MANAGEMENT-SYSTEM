import type { Role } from '@ssms/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; fullName: string };
    }
  }
}

export {};
