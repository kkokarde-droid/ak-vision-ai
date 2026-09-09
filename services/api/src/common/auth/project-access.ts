import {
  and,
  eq,
} from "drizzle-orm";

import {
  db,
  projects,
} from "@ak-vision-ai/database";

import {
  getOrganizationAccess,
  type OrganizationAccess,
} from "./organization-access.js";

export type ProjectAccess = {
  projectId: string;
  organizationId: string;
  userId: string;
  projectOwnerUserId: string;
  organization: OrganizationAccess;
  isProjectOwner: boolean;
};

export async function getProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  const result = await db
    .select({
      id: projects.id,
      organizationId:
        projects.organizationId,
      ownerUserId:
        projects.ownerUserId,
    })
    .from(projects)
    .where(
      eq(
        projects.id,
        projectId,
      ),
    )
    .limit(1);

  const project = result[0];

  if (!project) {
    return null;
  }

  const organization =
    await getOrganizationAccess(
      userId,
      project.organizationId,
    );

  if (!organization) {
    return null;
  }

  const isProjectOwner =
    project.ownerUserId === userId;

  return {
    projectId: project.id,
    organizationId:
      project.organizationId,
    userId,
    projectOwnerUserId:
      project.ownerUserId,
    organization,
    isProjectOwner,
  };
}

export function canManageProject(
  access: ProjectAccess | null,
): boolean {
  if (!access) {
    return false;
  }

  if (access.isProjectOwner) {
    return true;
  }

  return (
    access.organization.role ===
      "owner" ||
    access.organization.role ===
      "admin"
  );
}

export function canAccessProject(
  access: ProjectAccess | null,
): boolean {
  if (!access) {
    return false;
  }

  return true;
}

export async function requireProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const access =
    await getProjectAccess(
      userId,
      projectId,
    );

  if (!access) {
    throw new Error(
      "Project access denied",
    );
  }

  return access;
}

export async function requireProjectManagement(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const access =
    await requireProjectAccess(
      userId,
      projectId,
    );

  if (!canManageProject(access)) {
    throw new Error(
      "Project management access denied",
    );
  }

  return access;
}
