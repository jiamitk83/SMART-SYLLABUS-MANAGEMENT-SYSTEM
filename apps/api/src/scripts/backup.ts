import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { connectDb, dbName, disconnectDb } from '../db/connect';

/** Read-only JSON export of every collection into backups/<db>-<timestamp>/ (gitignored). */
async function main(): Promise<void> {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const dir = join(process.env.BACKUP_DIR ?? 'backups', `${dbName()}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  for (const c of await db.listCollections().toArray()) {
    const docs = await db.collection(c.name).find().toArray();
    writeFileSync(join(dir, `${c.name}.json`), JSON.stringify(docs));
    console.log(`${c.name}: ${docs.length}`);
  }
  console.log(`Backup written to ${dir}`);
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
