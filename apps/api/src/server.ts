import { createApp } from './app';
import { env } from './config/env';
import { connectDb, dbName, disconnectDb } from './db/connect';
import { ensureRoles } from './modules/auth/permissions.service';
import { generateReminders } from './modules/notifications/notifications.routes';

async function main(): Promise<void> {
  await connectDb();
  await ensureRoles();
  const app = createApp();
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`SSMS API listening on :${port} (db: ${dbName()})`));

  const timer = setInterval(() => {
    generateReminders().catch((err) => console.error('Reminder job failed', err));
  }, 6 * 60 * 60 * 1000);
  timer.unref();

  const shutdown = (): void => {
    clearInterval(timer);
    server.close(() => void disconnectDb().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
