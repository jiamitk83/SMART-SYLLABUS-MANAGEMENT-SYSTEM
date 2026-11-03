import type { Types } from 'mongoose';
import { PasswordResetModel, RefreshSessionModel, UserModel } from '../../models/auth.models';

export const authRepository = {
  findUserByIdentifier(identifier: string) {
    const value = identifier.trim().toLowerCase();
    return UserModel.findOne({ $or: [{ username: value }, { email: value }] }).select('+passwordHash');
  },
  findUserWithHash(id: string | Types.ObjectId) {
    return UserModel.findById(id).select('+passwordHash');
  },
  findUserById(id: string | Types.ObjectId) {
    return UserModel.findById(id);
  },
  createSession(data: {
    user: Types.ObjectId;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ip?: string;
  }) {
    return RefreshSessionModel.create(data);
  },
  findSessionByHash(tokenHash: string) {
    return RefreshSessionModel.findOne({ tokenHash });
  },
  revokeSession(tokenHash: string, reason: string, replacedByHash?: string) {
    return RefreshSessionModel.updateOne(
      { tokenHash, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: reason, replacedByHash } },
    );
  },
  revokeFamily(familyId: string, reason: string) {
    return RefreshSessionModel.updateMany(
      { familyId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    );
  },
  revokeAllForUser(userId: string | Types.ObjectId, reason: string) {
    return RefreshSessionModel.updateMany(
      { user: userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    );
  },
  listActiveSessions(userId: string) {
    return RefreshSessionModel.find({ user: userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .lean();
  },
  createResetToken(data: { user: Types.ObjectId; tokenHash: string; expiresAt: Date }) {
    return PasswordResetModel.create(data);
  },
  findResetToken(tokenHash: string) {
    return PasswordResetModel.findOne({ tokenHash });
  },
};
