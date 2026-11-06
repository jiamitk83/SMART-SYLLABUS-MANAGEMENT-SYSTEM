import { z } from 'zod';
import { ROLES } from '@ssms/shared';
import { passwordSchema } from '../auth/auth.validation';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Only letters, digits, dot, underscore and hyphen');

export const createUserBody = z.object({
  username,
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(ROLES),
  password: passwordSchema,
  employeeCode: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(20).optional(),
  mustChangePassword: z.boolean().default(false),
});

export const createTeacherBody = createUserBody.omit({ role: true });

export const updateUserBody = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    employeeCode: z.string().trim().max(40),
    phone: z.string().trim().max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const resetPasswordByAdminBody = z.object({ password: passwordSchema });

export const updateRoleBody = z.object({ permissions: z.array(z.string()).max(100) });

export const listUsersQuery = z.object({
  q: z.string().optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});
