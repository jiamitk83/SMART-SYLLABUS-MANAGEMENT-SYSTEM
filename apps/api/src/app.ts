import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { academicRoutes } from './modules/academic/academic.routes';
import { assessmentRoutes } from './modules/assessments/assessments.routes';
import { attendanceRoutes } from './modules/attendance/attendance.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { notificationRoutes } from './modules/notifications/notifications.routes';
import { plansRoutes } from './modules/plans/plans.routes';
import { progressRoutes } from './modules/progress/progress.routes';
import { dashboardRoutes, reportRoutes } from './modules/reports/reports.routes';
import { syllabusRoutes } from './modules/syllabus/syllabus.routes';
import { teachingRoutes } from './modules/teaching/teaching.routes';
import { usersRoutes } from './modules/users/users.routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.isProd ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes());
  for (const router of [
    usersRoutes(),
    academicRoutes(),
    syllabusRoutes(),
    plansRoutes(),
    teachingRoutes(),
    progressRoutes(),
    assessmentRoutes(),
    notificationRoutes(),
    dashboardRoutes(),
    reportRoutes(),
    attendanceRoutes(),
  ]) {
    app.use('/api', router);
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
