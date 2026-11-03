import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '@ssms/shared';

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 40 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, enum: ROLES, required: true, index: true },
    employeeCode: { type: String, trim: true },
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);
userSchema.index({ employeeCode: 1 }, { unique: true, partialFilterExpression: { employeeCode: { $type: 'string' } } });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const UserModel = model('User', userSchema);

const roleSchema = new Schema(
  {
    name: { type: String, enum: ROLES, required: true, unique: true },
    description: { type: String, default: '' },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const RoleModel = model('Role', roleSchema);

const refreshSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String },
    replacedByHash: { type: String },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true },
);
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
export type RefreshSessionDoc = InferSchemaType<typeof refreshSessionSchema> & { _id: Types.ObjectId };
export const RefreshSessionModel = model('RefreshSession', refreshSessionSchema);

const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
export const PasswordResetModel = model('PasswordReset', passwordResetSchema);

const immutable = (): never => {
  throw new Error('Audit logs are immutable');
};
const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorName: { type: String },
    action: { type: String, required: true, index: true },
    entityType: { type: String, index: true },
    entityId: { type: String },
    academicSession: { type: Schema.Types.ObjectId, ref: 'AcademicSession' },
    details: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  auditLogSchema.pre(op, immutable);
}
auditLogSchema.pre('save', function () {
  if (!this.isNew) immutable();
});
export const AuditLogModel = model('AuditLog', auditLogSchema);
