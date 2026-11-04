import { RoleModel } from '../models/auth.models';
import { connectDb, dbName, disconnectDb } from '../db/connect';
import { invalidatePermissionCache } from '../modules/auth/permissions.service';

/**
 * Additive, idempotent migration: grants the new attendance permissions to the roles that hold them by default.
 * Nothing is removed or overwritten. Take a backup first (`pnpm --filter @ssms/api backup`).
 */
const GRANTS: Record<string, string[]> = {
  PRINCIPAL: ['attendance:read', 'attendance:correct', 'attendance:lock', 'attendance:manage'],
  ACADEMIC_COORDINATOR: ['attendance:read'],
  TEACHER: ['attendance:read', 'attendance:mark'],
};

async function main(): Promise<void> {
  await connectDb();
  console.log(`Target database: ${dbName()}`);
  for (const [name, permissions] of Object.entries(GRANTS)) {
    const res = await RoleModel.updateOne({ name }, { $addToSet: { permissions: { $each: permissions } } });
    console.log(`${name}: ${res.modifiedCount ? 'permissions added' : res.matchedCount ? 'already present' : 'role document missing (created on next bootstrap)'}`);
  }
  invalidatePermissionCache();
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
