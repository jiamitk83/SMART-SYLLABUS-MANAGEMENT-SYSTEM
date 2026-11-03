import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ROLES, type Permission, type Role } from '@ssms/shared';
import { env } from '../config/env';
import { UserModel } from '../models/auth.models';
import { forbidden, unauthorized } from '../utils/errors';
import { hasPermission } from '../modules/auth/permissions.service';

export interface AccessPayload {
  sub: string;
  role: Role;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload: AccessPayload;
    try {
      payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as AccessPayload;
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await UserModel.findById(payload.sub).lean();
    if (!user || !user.isActive) throw unauthorized('Account is inactive or no longer exists');
    if (!ROLES.includes(user.role)) throw unauthorized();
    req.user = { id: String(user._id), role: user.role, fullName: user.fullName };
    next();
  } catch (err) {
    next(err);
  }
}

export function authorize(...permissions: Permission[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw unauthorized();
      for (const p of permissions) {
        if (await hasPermission(req.user.role, p)) return next();
      }
      throw forbidden();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Defence in depth for cookie-authenticated endpoints: a custom header cannot be sent cross-site without CORS approval. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.header('x-requested-with') !== 'ssms') return next(forbidden('Missing CSRF protection header'));
  next();
}
