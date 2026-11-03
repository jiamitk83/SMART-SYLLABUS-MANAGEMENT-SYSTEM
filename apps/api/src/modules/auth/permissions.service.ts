import { ROLES, ROLE_PERMISSIONS, PERMISSIONS, type Permission, type Role } from '@ssms/shared';
import { RoleModel } from '../../models/auth.models';

const TTL_MS = 30_000;
let cache: { at: number; map: Map<Role, Set<string>> } | null = null;

export function invalidatePermissionCache(): void {
  cache = null;
}

async function load(): Promise<Map<Role, Set<string>>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const rows = await RoleModel.find().lean();
  const map = new Map<Role, Set<string>>();
  for (const role of ROLES) {
    const row = rows.find((r) => r.name === role);
    map.set(role, new Set(row ? row.permissions : ROLE_PERMISSIONS[role]));
  }
  map.set('SUPER_ADMIN', new Set(PERMISSIONS));
  cache = { at: Date.now(), map };
  return map;
}

export async function getPermissions(role: Role): Promise<string[]> {
  return [...((await load()).get(role) ?? [])];
}

export async function hasPermission(role: Role, permission: Permission): Promise<boolean> {
  return ((await load()).get(role) ?? new Set()).has(permission);
}

/** Creates missing role documents only; never overwrites customised permissions. */
export async function ensureRoles(): Promise<void> {
  for (const role of ROLES) {
    await RoleModel.updateOne(
      { name: role },
      { $setOnInsert: { name: role, permissions: [...ROLE_PERMISSIONS[role]], description: role.replace('_', ' ') } },
      { upsert: true },
    );
  }
  invalidatePermissionCache();
}
