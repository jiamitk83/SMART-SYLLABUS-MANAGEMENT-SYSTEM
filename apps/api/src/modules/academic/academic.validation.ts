import { z } from 'zod';
import { objectId } from '../common/crud';

const optId = objectId.optional();
const date = z.coerce.date();

export const sessionCreate = z
  .object({
    name: z.string().trim().min(3).max(30),
    startDate: date,
    endDate: date,
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.endDate > v.startDate, { message: 'End date must be after start date', path: ['endDate'] });

export const sessionUpdate = z
  .object({ name: z.string().trim().min(3).max(30), startDate: date, endDate: date })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const classCreate = z.object({
  academicSession: optId,
  name: z.string().trim().min(1).max(40),
  order: z.number().int().min(0).max(100).optional(),
});
export const classUpdate = z.object({ name: z.string().trim().min(1).max(40), order: z.number().int().min(0).max(100) }).partial();

export const sectionCreate = z.object({ class: objectId, name: z.string().trim().min(1).max(20) });
export const sectionUpdate = z.object({ name: z.string().trim().min(1).max(20) });

export const subjectCreate = z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().min(2).max(12) });
export const subjectUpdate = subjectCreate.partial();

export const assignmentCreate = z.object({ academicSession: optId, section: objectId, subject: objectId, teacher: objectId });
export const assignmentUpdate = z.object({ teacher: objectId });
