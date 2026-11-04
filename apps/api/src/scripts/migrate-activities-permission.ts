import { RoleModel } from '../models/auth.models';
import { connectDb, dbName, disconnectDb } from '../db/connect';
import { invalidatePermissionCache } from '../modules/auth/permissions.service';

/**
 * Additive, idempotent migration: grants the new `activities:manage` permission to the roles that hold it by
 * default. Nothing is removed or overwritten. Take a backup first (`pnpm --filter @ssms/api backup`).
 */
const ROLES_TO_UPDATE = ['PRINCIPAL', 'ACADEMIC_COORDINATOR', 'TEACHER'];

async function main(): Promise<void> {
  await connectDb();
  for (const name of ROLES_TO_UPDATE) {
    const res = await RoleModel.updateOne({ name }, { $addToSet: { permissions: 'activities:manage' } });
    console.log(`${name}: ${res.modifiedCount ? 'permission added' : res.matchedCount ? 'already present' : 'role document missing (created on next bootstrap)'}`);
  }
  invalidatePermissionCache();
  console.log(`Done on database ${dbName()}`);
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
