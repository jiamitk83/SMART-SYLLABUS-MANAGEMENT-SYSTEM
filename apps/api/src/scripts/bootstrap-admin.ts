import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { connectDb, dbName, disconnectDb } from '../db/connect';
import { UserModel } from '../models/auth.models';
import { ensureRoles } from '../modules/auth/permissions.service';
import { passwordSchema } from '../modules/auth/auth.validation';

/** Idempotent: creates the first Super Admin only when none exists. Credentials come from the environment. */
async function main(): Promise<void> {
  const username = (process.env.ADMIN_USERNAME ?? '').trim().toLowerCase();
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || 'System Administrator';
  if (!username || !email || !password) throw new Error('Set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD before running this script');
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) throw new Error(`ADMIN_PASSWORD rejected: ${pw.error.issues[0]?.message}`);

  await connectDb();
  await ensureRoles();
  const existing = await UserModel.exists({ role: 'SUPER_ADMIN' });
  if (existing) {
    console.log(`A Super Admin already exists in ${dbName()}; nothing changed.`);
  } else {
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    await UserModel.create({ username, email, fullName, role: 'SUPER_ADMIN', passwordHash, isActive: true, mustChangePassword: true });
    console.log(`Super Admin "${username}" created in ${dbName()}. Password must be changed at first login.`);
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
