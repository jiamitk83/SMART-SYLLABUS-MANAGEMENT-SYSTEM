import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/errors';
import { authService, type RequestMeta } from './auth.service';

export const REFRESH_COOKIE = 'ssms_refresh';

const cookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'strict',
  path: '/api/auth',
  expires,
});

const meta = (req: Request): RequestMeta => ({ ip: req.ip, userAgent: req.header('user-agent') });

function sendSession(
  res: Response,
  result: { accessToken: string; refreshToken: string; refreshExpiresAt: Date; user?: unknown },
  status = 200,
): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(result.refreshExpiresAt));
  res.status(status).json({ accessToken: result.accessToken, user: result.user });
}

export const authController = {
  login: asyncHandler(async (req, res) => {
    const { identifier, password } = req.body as { identifier: string; password: string };
    sendSession(res, await authService.login(identifier, password, meta(req)));
  }),

  refresh: asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    try {
      sendSession(res, await authService.refresh(token, meta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  }),

  logout: asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    await authService.logout(token, undefined, req.ip);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  }),

  me: asyncHandler(async (req, res) => {
    res.json({ user: await authService.me(req.user!.id) });
  }),

  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const tokens = await authService.changePassword(req.user!.id, currentPassword, newPassword, meta(req));
    sendSession(res, { ...tokens, user: await authService.me(req.user!.id) });
  }),

  forgotPassword: asyncHandler(async (req, res) => {
    const { identifier } = req.body as { identifier: string };
    const token = await authService.forgotPassword(identifier, meta(req));
    // No mail transport is configured: outside production the token is logged for the operator.
    if (token && !env.isProd && !env.isTest) console.info(`[password-reset] token for ${identifier}: ${token}`);
    const body: { message: string; devToken?: string } = {
      message: 'If the account exists, reset instructions have been issued.',
    };
    if (token && env.isTest) body.devToken = token;
    res.json(body);
  }),

  resetPassword: asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    await authService.resetPassword(token, newPassword, meta(req));
    res.json({ message: 'Password updated. Please sign in.' });
  }),

  sessions: asyncHandler(async (req, res) => {
    res.json({ data: await authService.listSessions(req.user!.id) });
  }),

  revokeSessions: asyncHandler(async (req, res) => {
    await authService.revokeAllSessions(req.user!.id, 'USER_REVOKED_ALL');
    res.status(204).end();
  }),
};
