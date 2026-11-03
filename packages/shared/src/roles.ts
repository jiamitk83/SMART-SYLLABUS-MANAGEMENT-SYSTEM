export const ROLES = ['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR', 'TEACHER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'users:manage',
  'roles:manage',
  'settings:manage',
  'audit:read',
  'academic:read',
  'academic:manage',
  'syllabus:read',
  'syllabus:manage',
  'plans:read',
  'plans:manage',
  'teaching:read:all',
  'teaching:write',
  'completion:record',
  'completion:approve',
  'assessments:read',
  'assessments:manage',
  'reports:read',
  'dashboard:read',
  'notifications:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  PRINCIPAL: [
    'academic:read',
    'syllabus:read',
    'plans:read',
    'teaching:read:all',
    'completion:approve',
    'assessments:read',
    'reports:read',
    'dashboard:read',
    'audit:read',
    'notifications:manage',
  ],
  ACADEMIC_COORDINATOR: [
    'academic:read',
    'syllabus:read',
    'syllabus:manage',
    'plans:read',
    'plans:manage',
    'teaching:read:all',
    'completion:approve',
    'assessments:read',
    'assessments:manage',
    'reports:read',
    'dashboard:read',
    'notifications:manage',
  ],
  TEACHER: [
    'academic:read',
    'syllabus:read',
    'plans:read',
    'teaching:write',
    'completion:record',
    'assessments:read',
    'assessments:manage',
    'reports:read',
    'dashboard:read',
  ],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ACTIVITY_TYPES = [
  'TEACHING',
  'NOTEBOOK_WORK',
  'NOTEBOOK_CORRECTION',
  'WORKSHEET',
  'TEST',
  'REVISION',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const DEFAULT_ACTIVITY_WEIGHTS: Record<ActivityType, number> = {
  TEACHING: 40,
  NOTEBOOK_WORK: 15,
  NOTEBOOK_CORRECTION: 15,
  WORKSHEET: 10,
  TEST: 10,
  REVISION: 10,
};

export const TEACHING_STATUSES = ['COMPLETED', 'PARTIAL', 'NOT_TAUGHT'] as const;
export type TeachingStatus = (typeof TEACHING_STATUSES)[number];

export const RECORD_STATES = ['DRAFT', 'SUBMITTED'] as const;
export type RecordState = (typeof RECORD_STATES)[number];

export const CHAPTER_IMPORTANCE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ChapterImportance = (typeof CHAPTER_IMPORTANCE)[number];
