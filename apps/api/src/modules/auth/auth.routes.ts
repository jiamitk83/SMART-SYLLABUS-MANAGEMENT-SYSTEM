import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { authenticate, csrfGuard } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { authController } from './auth.controller';
import { changePasswordBody, forgotPasswordBody, loginBody, resetPasswordBody } from './auth.validation';

const limiter = (max: number) =>
  rateLimit({
    windowMs: env.LOGIN_RATE_WINDOW_MIN * 60_000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
  });

export function authRoutes(): Router {
  const r = Router();
  const loginLimiter = limiter(env.LOGIN_RATE_MAX);
  const resetLimiter = limiter(Math.max(3, Math.floor(env.LOGIN_RATE_MAX / 2)));
  r.post('/login', loginLimiter, validate({ body: loginBody }), authController.login);
  r.post('/refresh', csrfGuard, authController.refresh);
  r.post('/logout', csrfGuard, authController.logout);
  r.post('/forgot-password', resetLimiter, validate({ body: forgotPasswordBody }), authController.forgotPassword);
  r.post('/reset-password', resetLimiter, validate({ body: resetPasswordBody }), authController.resetPassword);
  r.get('/me', authenticate, authController.me);
  r.post('/change-password', authenticate, validate({ body: changePasswordBody }), authController.changePassword);
  r.get('/sessions', authenticate, authController.sessions);
  r.delete('/sessions', authenticate, authController.revokeSessions);
  return r;
}
