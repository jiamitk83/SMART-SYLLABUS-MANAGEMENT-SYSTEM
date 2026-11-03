import type { Role } from '@ssms/shared';
import { UserModel, type UserDoc } from '../../models/auth.models';
import { escapeRegex } from '../common/crud';

export interface UserListQuery {
  q?: string;
  role?: Role;
  isActive?: 'true' | 'false';
  skip: number;
  limit: number;
}

export const usersRepository = {
  async list(query: UserListQuery) {
    const filter: Record<string, unknown> = {};
    if (query.role) filter.role = query.role;
    if (query.isActive) filter.isActive = query.isActive === 'true';
    if (query.q?.trim()) {
      const rx = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [{ username: rx }, { email: rx }, { fullName: rx }, { employeeCode: rx }];
    }
    const [data, total] = await Promise.all([
      UserModel.find(filter).sort({ fullName: 1 }).skip(query.skip).limit(query.limit).lean(),
      UserModel.countDocuments(filter),
    ]);
    return { data: data as UserDoc[], total };
  },
  findById: (id: string) => UserModel.findById(id),
  create: (data: Record<string, unknown>) => UserModel.create(data),
  countActiveSuperAdmins: () => UserModel.countDocuments({ role: 'SUPER_ADMIN', isActive: true }),
};
