import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import fs from 'node:fs';
import helmet from 'helmet';
import path from 'node:path';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { academicRoutes } from './modules/academic/academic.routes';
import { assessmentRoutes } from './modules/assessments/assessments.routes';
import { attendanceReportRoutes } from './modules/attendance/attendance.reports';
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
    attendanceReportRoutes(),
  ]) {
    app.use('/api', router);
  }
  const distPath = path.resolve(process.cwd(), 'apps/web/dist');

  console.log("Checking frontend dist path at:", distPath);
  console.log("Does path exist?:", fs.existsSync(distPath));

  const finalDistPath = fs.existsSync(distPath)
    ? distPath
    : path.resolve(process.cwd(), 'web/dist');

  app.use(express.static(finalDistPath));

  app.get('*', (_req, res) => {
    const indexPath = path.join(finalDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Frontend build files missing" } });
    }
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
