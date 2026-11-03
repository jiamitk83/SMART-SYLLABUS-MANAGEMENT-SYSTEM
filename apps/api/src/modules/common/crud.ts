import { Router, type Request } from 'express';
import type { Model, PopulateOptions } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import type { Permission } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { asyncHandler, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';

export type Doc = Record<string, unknown> & { _id: unknown };

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParam = z.object({ id: objectId });

export interface Page {
  page: number;
  pageSize: number;
  skip: number;
}

export function parsePage(query: Record<string, unknown>): Page {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CrudHooks {
  beforeCreate?(data: Record<string, unknown>, req: Request): Promise<Record<string, unknown>>;
  beforeUpdate?(data: Record<string, unknown>, existing: Doc, req: Request): Promise<Record<string, unknown>>;
  scope?(req: Request): Promise<Record<string, unknown>>;
  beforeActive?(existing: Doc, isActive: boolean, req: Request): Promise<void>;
  afterChange?(doc: Doc, req: Request, kind: 'create' | 'update' | 'active'): Promise<void>;
}

export interface CrudConfig {
  entity: string;
  model: Model<Record<string, unknown>>;
  read: Permission;
  write: Permission;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  searchFields?: string[];
  filterFields?: string[];
  populate?: PopulateOptions[];
  sort?: Record<string, 1 | -1>;
  hooks?: CrudHooks;
  bulk?: boolean;
}

export function createCrudRouter(cfg: CrudConfig): Router {
  const r = Router();
  const { model, hooks = {} } = cfg;
  const sessionOf = (d: Doc): string | undefined => (d.academicSession ? String(d.academicSession) : undefined);

  r.use(authenticate);

  r.get(
    '/',
    authorize(cfg.read),
    asyncHandler(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      const conditions: Record<string, unknown>[] = [];
      if (hooks.scope) conditions.push(await hooks.scope(req));
      const userFilter: Record<string, unknown> = {};
      for (const key of cfg.filterFields ?? []) {
        if (typeof q[key] === 'string' && q[key] !== '') userFilter[key] = q[key];
      }
      conditions.push(userFilter);
      if (typeof q.q === 'string' && q.q.trim() && cfg.searchFields?.length) {
        const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
        conditions.push({ $or: cfg.searchFields.map((f) => ({ [f]: rx })) });
      }
      const filter: Record<string, unknown> = { $and: conditions };
      const { page, pageSize, skip } = parsePage(q);
      const [data, total] = await Promise.all([
        model
          .find(filter)
          .populate(cfg.populate ?? [])
          .sort(cfg.sort ?? { createdAt: -1 })
          .skip(skip)
          .limit(pageSize)
          .lean(),
        model.countDocuments(filter),
      ]);
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  r.get(
    '/:id',
    authorize(cfg.read),
    asyncHandler(async (req, res) => {
      const filter = hooks.scope ? await hooks.scope(req) : {};
      const doc = await model
        .findOne({ $and: [filter, { _id: idParam.parse(req.params).id }] })
        .populate(cfg.populate ?? [])
        .lean();
      if (!doc) throw notFound();
      res.json({ data: doc });
    }),
  );

  r.post(
    '/',
    authorize(cfg.write),
    validate({ body: cfg.createSchema }),
    asyncHandler(async (req, res) => {
      let data = req.body as Record<string, unknown>;
      if (hooks.beforeCreate) data = await hooks.beforeCreate(data, req);
      const created = await model.create(data);
      const doc = created.toObject() as Doc;
      await audit(req, {
        action: `${cfg.entity}_CREATED`,
        entityType: cfg.entity,
        entityId: String(doc._id),
        academicSession: sessionOf(doc),
        details: data,
      });
      if (hooks.afterChange) await hooks.afterChange(doc, req, 'create');
      res.status(201).json({ data: doc });
    }),
  );

  if (cfg.bulk) {
    r.post(
      '/bulk',
      authorize(cfg.write),
      validate({ body: z.object({ items: z.array(z.unknown()).min(1).max(1000) }) }),
      asyncHandler(async (req, res) => {
        const { items } = req.body as { items: unknown[] };
        let created = 0;
        const skipped: Array<{ index: number; reason: string }> = [];
        for (const [index, raw] of items.entries()) {
          const parsed = cfg.createSchema.safeParse(raw);
          if (!parsed.success) {
            skipped.push({ index, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
            continue;
          }
          try {
            let data = parsed.data as Record<string, unknown>;
            if (hooks.beforeCreate) data = await hooks.beforeCreate(data, req);
            const doc = (await model.create(data)).toObject() as Doc;
            created += 1;
            await audit(req, { action: `${cfg.entity}_CREATED`, entityType: cfg.entity, entityId: String(doc._id), academicSession: sessionOf(doc), details: { bulk: true } });
          } catch (err) {
            const dup = (err as { code?: number }).code === 11000;
            skipped.push({ index, reason: dup ? 'Duplicate' : err instanceof Error ? err.message : 'Failed' });
          }
        }
        res.status(201).json({ created, skipped });
      }),
    );
  }

  r.patch(
    '/:id',
    authorize(cfg.write),
    validate({ body: cfg.updateSchema }),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const existing = (await model.findById(id).lean()) as Doc | null;
      if (!existing) throw notFound();
      let data = req.body as Record<string, unknown>;
      if (hooks.beforeUpdate) data = await hooks.beforeUpdate(data, existing, req);
      const updated = (await model
        .findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
        .lean()) as Doc | null;
      if (!updated) throw notFound();
      await audit(req, {
        action: `${cfg.entity}_UPDATED`,
        entityType: cfg.entity,
        entityId: id,
        academicSession: sessionOf(updated),
        details: { changes: data },
      });
      if (hooks.afterChange) await hooks.afterChange(updated, req, 'update');
      res.json({ data: updated });
    }),
  );

  r.patch(
    '/:id/active',
    authorize(cfg.write),
    validate({ body: z.object({ isActive: z.boolean() }) }),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const { isActive } = req.body as { isActive: boolean };
      if (hooks.beforeActive) {
        const existing = (await model.findById(id).lean()) as Doc | null;
        if (!existing) throw notFound();
        await hooks.beforeActive(existing, isActive, req);
      }
      const updated = (await model.findByIdAndUpdate(id, { $set: { isActive } }, { new: true }).lean()) as Doc | null;
      if (!updated) throw notFound();
      await audit(req, {
        action: `${cfg.entity}_${isActive ? 'ACTIVATED' : 'DEACTIVATED'}`,
        entityType: cfg.entity,
        entityId: id,
        academicSession: sessionOf(updated),
      });
      if (hooks.afterChange) await hooks.afterChange(updated, req, 'active');
      res.json({ data: updated });
    }),
  );

  return r;
}
