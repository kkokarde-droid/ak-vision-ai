import {
  and,
  eq,
} from "drizzle-orm";

import {
  conversations,
  db,
} from "@ak-vision-ai/database";

import {
  getProjectAccess,
  type ProjectAccess,
} from "./project-access.js";

export type ConversationAccess = {
  conversationId: string;
  projectId: string;
  conversationUserId: string;
  userId: string;
  project: ProjectAccess;
  isConversationOwner: boolean;
};

export async function getConversationAccess(
  userId: string,
  conversationId: string,
): Promise<ConversationAccess | null> {
  const result = await db
    .select({
      id: conversations.id,
      projectId: conversations.projectId,
      conversationUserId:
        conversations.userId,
    })
    .from(conversations)
    .where(
      eq(
        conversations.id,
        conversationId,
      ),
    )
    .limit(1);

  const conversation = result[0];

  if (!conversation) {
    return null;
  }

  const project =
    await getProjectAccess(
      userId,
      conversation.projectId,
    );

  if (!project) {
    return null;
  }

  return {
    conversationId:
      conversation.id,
    projectId:
      conversation.projectId,
    conversationUserId:
      conversation.conversationUserId,
    userId,
    project,
    isConversationOwner:
      conversation.conversationUserId ===
      userId,
  };
}

export function canAccessConversation(
  access:
    | ConversationAccess
    | null,
): boolean {
  if (!access) {
    return false;
  }

  return true;
}

export function canManageConversation(
  access:
    | ConversationAccess
    | null,
): boolean {
  if (!access) {
    return false;
  }

  if (
    access.isConversationOwner
  ) {
    return true;
  }

  return (
    access.project.isProjectOwner ||
    access.project.organization.role ===
      "owner" ||
    access.project.organization.role ===
      "admin"
  );
}

export async function requireConversationAccess(
  userId: string,
  conversationId: string,
): Promise<ConversationAccess> {
  const access =
    await getConversationAccess(
      userId,
      conversationId,
    );

  if (!access) {
    throw new Error(
      "Conversation access denied",
    );
  }

  return access;
}

export async function requireConversationManagement(
  userId: string,
  conversationId: string,
): Promise<ConversationAccess> {
  const access =
    await requireConversationAccess(
      userId,
      conversationId,
    );

  if (!canManageConversation(access)) {
    throw new Error(
      "Conversation management access denied",
    );
  }

  return access;
}
