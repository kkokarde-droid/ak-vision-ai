import {
  and,
  eq,
} from "drizzle-orm";

import {
  db,
  organizationMemberships,
  organizations,
} from "@ak-vision-ai/database";

export type OrganizationRole =
  | "owner"
  | "admin"
  | "member"
  | "billing";

export type OrganizationAccess = {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  isOwner: boolean;
};

export async function getOrganizationAccess(
  userId: string,
  organizationId: string,
): Promise<OrganizationAccess | null> {
  const result = await db
    .select({
      organizationId: organizations.id,
      ownerUserId: organizations.ownerUserId,
      membershipUserId:
        organizationMemberships.userId,
      membershipRole:
        organizationMemberships.role,
    })
    .from(organizations)
    .leftJoin(
      organizationMemberships,
      and(
        eq(
          organizationMemberships.organizationId,
          organizations.id,
        ),
        eq(
          organizationMemberships.userId,
          userId,
        ),
      ),
    )
    .where(
      eq(
        organizations.id,
        organizationId,
      ),
    )
    .limit(1);

  const row = result[0];

  if (!row) {
    return null;
  }

  const isOwner =
    row.ownerUserId === userId;

  if (isOwner) {
    return {
      organizationId:
        row.organizationId,
      userId,
      role: "owner",
      isOwner: true,
    };
  }

  if (
    !row.membershipUserId ||
    !row.membershipRole
  ) {
    return null;
  }

  return {
    organizationId:
      row.organizationId,
    userId,
    role:
      row.membershipRole,
    isOwner: false,
  };
}

export function hasOrganizationRole(
  access: OrganizationAccess | null,
  ...allowedRoles: OrganizationRole[]
): boolean {
  if (!access) {
    return false;
  }

  return allowedRoles.includes(
    access.role,
  );
}

export async function requireOrganizationAccess(
  userId: string,
  organizationId: string,
): Promise<OrganizationAccess> {
  const access =
    await getOrganizationAccess(
      userId,
      organizationId,
    );

  if (!access) {
    throw new Error(
      "Organization access denied",
    );
  }

  return access;
}
