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
  const password = process.env.ADMIN_PASSWORD?.trim() ?? '';
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || 'System Administrator';
  if (!username || !email || !password) throw new Error('Set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD before running this script');
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) throw new Error(`ADMIN_PASSWORD rejected: ${pw.error.issues[0]?.message}`);

  await connectDb();
  await ensureRoles();
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const existing = await UserModel.findOne({ role: 'SUPER_ADMIN' });
  if (existing) {
    existing.username = username;
    existing.email = email;
    existing.fullName = fullName;
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    existing.mustChangePassword = false;
    await existing.save();
    console.log(`Super Admin "${username}" updated in ${dbName()}.`);
  } else {
    await UserModel.create({ username, email, fullName, role: 'SUPER_ADMIN', passwordHash, isActive: true, mustChangePassword: false });
    console.log(`Super Admin "${username}" created in ${dbName()}.`);
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
