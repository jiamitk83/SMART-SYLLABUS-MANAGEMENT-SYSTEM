import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/\d/, 'Needs a digit');
