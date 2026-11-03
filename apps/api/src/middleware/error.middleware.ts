import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

export function validate<B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny>(schemas: {
  body?: B;
  query?: Q;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body) as z.infer<B>;
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'Route not found', 'NOT_FOUND'));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Invalid ${err.path}` } });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    return;
  }
  const mongoErr = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (mongoErr?.code === 11000) {
    res.status(409).json({
      error: { code: 'DUPLICATE', message: `Duplicate value for ${Object.keys(mongoErr.keyPattern ?? {}).join(', ') || 'unique field'}` },
    });
    return;
  }
  if (!env.isTest) console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
