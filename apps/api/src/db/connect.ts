import mongoose from 'mongoose';
import { env } from '../config/env';

export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { autoIndex: true });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbName(): string {
  return mongoose.connection.name;
}
