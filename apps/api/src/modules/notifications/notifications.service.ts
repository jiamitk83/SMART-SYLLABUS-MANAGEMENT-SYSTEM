import type { Role } from '@ssms/shared';
import { UserModel } from '../../models/auth.models';
import { NotificationModel } from '../../models/planning.models';

export interface NotifyInput {
  type: 'PENDING_ACTIVITY' | 'DELAYED_CHAPTER' | 'UPCOMING_DEADLINE' | 'REVIEW_REQUEST' | 'ANNOUNCEMENT';
  title: string;
  message?: string;
  link?: string;
  dedupeKey?: string;
}

/** Inserts one notification per recipient; a repeated dedupeKey is silently ignored. Returns count created. */
export async function notifyUsers(userIds: string[], input: NotifyInput): Promise<number> {
  let created = 0;
  for (const user of new Set(userIds)) {
    try {
      await NotificationModel.create({ user, ...input });
      created += 1;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return created;
}

export async function usersWithRoles(roles: Role[]): Promise<string[]> {
  const rows = await UserModel.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
  return rows.map((r) => String(r._id));
}
