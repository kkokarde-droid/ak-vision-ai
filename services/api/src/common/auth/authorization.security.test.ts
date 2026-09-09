import test from "node:test";
import assert from "node:assert/strict";

import {
  and,
  eq,
} from "drizzle-orm";

import {
  authSessions,
  conversations,
  creditTransactions,
  creditReservations,
  creditBalances,
  db,
  messages,
  organizationMemberships,
  organizations,
  projects,
  users,
} from "@ak-vision-ai/database";

import { buildApp } from "../../app.js";
import { createSession } from "./session.service.js";

import {
  addCredits,
  reserveCredit,
} from "@ak-vision-ai/credits";

type SecurityContext = {
  userA: string;
  userB: string;
  orgA: string;
  orgB: string;
  projectA: string;
  projectB: string;
  conversationA: string;
  conversationB: string;
  messageA: string;
  messageB: string;
  tokenA: string;
  tokenB: string;
};

async function createUser(
  email: string,
  role:
    | "customer"
    | "admin"
    | "super_admin" = "customer",
) {
  const result = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      role,
      status: "active",
      accountType: "individual",
    })
    .returning({
      id: users.id,
    });

  const user = result[0];

  assert.ok(user);

  return user.id;
}

async function createSecurityContext(): Promise<SecurityContext> {
  const userA = await createUser(
    `security-a-${crypto.randomUUID()}@example.test`,
  );

  const userB = await createUser(
    `security-b-${crypto.randomUUID()}@example.test`,
  );

  const orgAResult = await db
    .insert(organizations)
    .values({
      name: "Security Org A",
      ownerUserId: userA,
    })
    .returning({
      id: organizations.id,
    });

  const orgBResult = await db
    .insert(organizations)
    .values({
      name: "Security Org B",
      ownerUserId: userB,
    })
    .returning({
      id: organizations.id,
    });

  const orgA = orgAResult[0];
  const orgB = orgBResult[0];

  assert.ok(orgA);
  assert.ok(orgB);

  await db
    .insert(organizationMemberships)
    .values([
      {
        organizationId: orgA.id,
        userId: userA,
        role: "owner",
      },
      {
        organizationId: orgB.id,
        userId: userB,
        role: "owner",
      },
    ]);

  const projectAResult = await db
    .insert(projects)
    .values({
      organizationId: orgA.id,
      ownerUserId: userA,
      name: "Project A",
      type: "general",
      status: "active",
    })
    .returning({
      id: projects.id,
    });

  const projectBResult = await db
    .insert(projects)
    .values({
      organizationId: orgB.id,
      ownerUserId: userB,
      name: "Project B",
      type: "general",
      status: "active",
    })
    .returning({
      id: projects.id,
    });

  const projectA = projectAResult[0];
  const projectB = projectBResult[0];

  assert.ok(projectA);
  assert.ok(projectB);

  const conversationAResult =
    await db
      .insert(conversations)
      .values({
        projectId: projectA.id,
        userId: userA,
        title: "Conversation A",
        status: "active",
      })
      .returning({
        id: conversations.id,
      });

  const conversationBResult =
    await db
      .insert(conversations)
      .values({
        projectId: projectB.id,
        userId: userB,
        title: "Conversation B",
        status: "active",
      })
      .returning({
        id: conversations.id,
      });

  const conversationA =
    conversationAResult[0];

  const conversationB =
    conversationBResult[0];

  assert.ok(conversationA);
  assert.ok(conversationB);

  const messageAResult = await db
    .insert(messages)
    .values({
      conversationId: conversationA.id,
      role: "user",
      contentType: "text",
      content: "Secret A",
    })
    .returning({
      id: messages.id,
    });

  const messageBResult = await db
    .insert(messages)
    .values({
      conversationId: conversationB.id,
      role: "user",
      contentType: "text",
      content: "Secret B",
    })
    .returning({
      id: messages.id,
    });

  const messageA = messageAResult[0];
  const messageB = messageBResult[0];

  assert.ok(messageA);
  assert.ok(messageB);

  const sessionA =
    await createSession(userA);

  const sessionB =
    await createSession(userB);

  return {
    userA,
    userB,
    orgA: orgA.id,
    orgB: orgB.id,
    projectA: projectA.id,
    projectB: projectB.id,
    conversationA:
      conversationA.id,
    conversationB:
      conversationB.id,
    messageA: messageA.id,
    messageB: messageB.id,
    tokenA: sessionA.token,
    tokenB: sessionB.token,
  };
}

async function cleanupSecurityContext(
  context: SecurityContext,
) {
  await db
    .delete(authSessions)
    .where(
      and(
        eq(
          authSessions.userId,
          context.userA,
        ),
      ),
    );

  await db
    .delete(authSessions)
    .where(
      eq(
        authSessions.userId,
        context.userB,
      ),
    );

  await db
    .delete(messages)
    .where(
      eq(
        messages.id,
        context.messageA,
      ),
    );

  await db
    .delete(messages)
    .where(
      eq(
        messages.id,
        context.messageB,
      ),
    );

  await db
    .delete(conversations)
    .where(
      eq(
        conversations.id,
        context.conversationA,
      ),
    );

  await db
    .delete(conversations)
    .where(
      eq(
        conversations.id,
        context.conversationB,
      ),
    );

  await db
    .delete(projects)
    .where(
      eq(
        projects.id,
        context.projectA,
      ),
    );

  await db
    .delete(projects)
    .where(
      eq(
        projects.id,
        context.projectB,
      ),
    );

  await db
    .delete(organizationMemberships)
    .where(
      eq(
        organizationMemberships.organizationId,
        context.orgA,
      ),
    );

  await db
    .delete(organizationMemberships)
    .where(
      eq(
        organizationMemberships.organizationId,
        context.orgB,
      ),
    );

  await db
    .delete(organizations)
    .where(
      eq(
        organizations.id,
        context.orgA,
      ),
    );

  await db
    .delete(organizations)
    .where(
      eq(
        organizations.id,
        context.orgB,
      ),
    );

  await db
    .delete(users)
    .where(
      eq(
        users.id,
        context.userA,
      ),
    );

  await db
    .delete(users)
    .where(
      eq(
        users.id,
        context.userB,
      ),
    );
}

test(
  "protected resource endpoints reject anonymous access",
  async () => {
    const app =
      buildApp();

    try {
      const paths = [
        "/api/v1/organizations",
        "/api/v1/memberships",
        "/api/v1/projects",
        "/api/v1/conversations",
        "/api/v1/messages",
      ];

      for (const url of paths) {
        const response =
          await app.inject({
            method: "GET",
            url,
          });

        assert.equal(
          response.statusCode,
          401,
          url,
        );
      }
    } finally {
      await app.close();
    }
  },
);

test(
  "user A cannot read user B organization",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/organizations/${context.orgB}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "user A cannot read user B project",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/projects/${context.projectB}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "user A cannot read user B conversation",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/conversations/${context.conversationB}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "user A cannot read user B message",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "GET",
          url:
            `/api/v1/messages/${context.messageB}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        404,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "revoked session cannot access protected resources",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const revokeResponse =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/auth/logout",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        revokeResponse.statusCode,
        200,
      );

      const response =
        await app.inject({
          method: "GET",
          url:
            "/api/v1/projects",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        401,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "user A cannot create a conversation using user B identity",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/conversations",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            projectId:
              context.projectB,
            userId:
              context.userB,
            title:
              "Unauthorized conversation",
          },
        });

      assert.notEqual(
        response.statusCode,
        201,
      );

      assert.ok(
        response.statusCode ===
          403 ||
        response.statusCode ===
          404,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "user A cannot create a project owned by user B",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/projects",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            organizationId:
              context.orgB,
            ownerUserId:
              context.userB,
            name:
              "Cross tenant project",
          },
        });

      assert.notEqual(
        response.statusCode,
        201,
      );

      assert.ok(
        response.statusCode ===
          403 ||
        response.statusCode ===
          400 ||
        response.statusCode ===
          404,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization member cannot promote another member to admin",
  async () => {
    const context = await createSecurityContext();

    const memberId = await createUser(
      `security-member-${crypto.randomUUID()}@example.test`,
    );

    await db.insert(organizationMemberships).values({
      organizationId: context.orgA,
      userId: memberId,
      role: "member",
    });

    const memberSession =
      await createSession(memberId);

    const membershipResult = await db
      .select({
        id: organizationMemberships.id,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(
            organizationMemberships.organizationId,
            context.orgA,
          ),
          eq(
            organizationMemberships.userId,
            memberId,
          ),
        ),
      )
      .limit(1);

    const membership =
      membershipResult[0];

    assert.ok(membership);

    const app = buildApp();

    try {
      const response =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/memberships/${membership.id}`,
          headers: {
            cookie:
              `ak_vision_session=${memberSession.token}`,
          },
          payload: {
            role: "admin",
          },
        });

      assert.equal(
        response.statusCode,
        403,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            memberId,
          ),
        );

      await db
        .delete(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.userId,
            memberId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            memberId,
          ),
        );

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization admin cannot promote a member to admin or owner",
  async () => {
    const context =
      await createSecurityContext();

    const adminId = await createUser(
      `security-admin-${crypto.randomUUID()}@example.test`,
    );

    const memberId = await createUser(
      `security-member-2-${crypto.randomUUID()}@example.test`,
    );

    const rows = await db
      .insert(
        organizationMemberships,
      )
      .values([
        {
          organizationId:
            context.orgA,
          userId: adminId,
          role: "admin",
        },
        {
          organizationId:
            context.orgA,
          userId: memberId,
          role: "member",
        },
      ])
      .returning({
        id:
          organizationMemberships.id,
        userId:
          organizationMemberships.userId,
      });

    const targetMembership =
      rows.find(
        (row) =>
          row.userId === memberId,
      );

    assert.ok(
      targetMembership,
    );

    const adminSession =
      await createSession(
        adminId,
      );

    const app = buildApp();

    try {
      const adminResponse =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/memberships/${targetMembership.id}`,
          headers: {
            cookie:
              `ak_vision_session=${adminSession.token}`,
          },
          payload: {
            role: "admin",
          },
        });

      assert.equal(
        adminResponse.statusCode,
        403,
      );

      const ownerResponse =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/memberships/${targetMembership.id}`,
          headers: {
            cookie:
              `ak_vision_session=${adminSession.token}`,
          },
          payload: {
            role: "owner",
          },
        });

      assert.equal(
        ownerResponse.statusCode,
        403,
      );
    } finally {
      await app.close();

      for (const userId of [
        adminId,
        memberId,
      ]) {
        await db
          .delete(authSessions)
          .where(
            eq(
              authSessions.userId,
              userId,
            ),
          );

        await db
          .delete(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.userId,
              userId,
            ),
          );

        await db
          .delete(users)
          .where(
            eq(
              users.id,
              userId,
            ),
          );
      }

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "admin cannot remove another organization admin",
  async () => {
    const context =
      await createSecurityContext();

    const adminA = await createUser(
      `security-admin-a-${crypto.randomUUID()}@example.test`,
    );

    const adminB = await createUser(
      `security-admin-b-${crypto.randomUUID()}@example.test`,
    );

    const rows = await db
      .insert(
        organizationMemberships,
      )
      .values([
        {
          organizationId:
            context.orgA,
          userId: adminA,
          role: "admin",
        },
        {
          organizationId:
            context.orgA,
          userId: adminB,
          role: "admin",
        },
      ])
      .returning({
        id:
          organizationMemberships.id,
        userId:
          organizationMemberships.userId,
      });

    const target =
      rows.find(
        (row) =>
          row.userId === adminB,
      );

    assert.ok(target);

    const session =
      await createSession(
        adminA,
      );

    const app = buildApp();

    try {
      const response =
        await app.inject({
          method: "DELETE",
          url:
            `/api/v1/memberships/${target.id}`,
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
        });

      assert.equal(
        response.statusCode,
        403,
      );
    } finally {
      await app.close();

      for (const userId of [
        adminA,
        adminB,
      ]) {
        await db
          .delete(authSessions)
          .where(
            eq(
              authSessions.userId,
              userId,
            ),
          );

        await db
          .delete(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.userId,
              userId,
            ),
          );

        await db
          .delete(users)
          .where(
            eq(
              users.id,
              userId,
            ),
          );
      }

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "member cannot modify or delete another organization's project",
  async () => {
    const context =
      await createSecurityContext();

    const memberId =
      await createUser(
        `security-project-member-${crypto.randomUUID()}@example.test`,
      );

    await db
      .insert(
        organizationMemberships,
      )
      .values({
        organizationId:
          context.orgA,
        userId: memberId,
        role: "member",
      });

    const session =
      await createSession(
        memberId,
      );

    const app = buildApp();

    try {
      const patch =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/projects/${context.projectB}`,
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
          payload: {
            name: "tampered",
          },
        });

      assert.equal(
        patch.statusCode,
        404,
      );

      const remove =
        await app.inject({
          method: "DELETE",
          url:
            `/api/v1/projects/${context.projectB}`,
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
        });

      assert.equal(
        remove.statusCode,
        404,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            memberId,
          ),
        );

      await db
        .delete(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.userId,
            memberId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            memberId,
          ),
        );

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "member cannot modify or delete another organization's conversation or message",
  async () => {
    const context =
      await createSecurityContext();

    const memberId =
      await createUser(
        `security-resource-member-${crypto.randomUUID()}@example.test`,
      );

    await db
      .insert(
        organizationMemberships,
      )
      .values({
        organizationId:
          context.orgA,
        userId: memberId,
        role: "member",
      });

    const session =
      await createSession(
        memberId,
      );

    const app = buildApp();

    try {
      const conversationPatch =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/conversations/${context.conversationB}`,
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
          payload: {
            title: "tampered",
          },
        });

      assert.equal(
        conversationPatch.statusCode,
        404,
      );

      const conversationDelete =
        await app.inject({
          method: "DELETE",
          url:
            `/api/v1/conversations/${context.conversationB}`,
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
        });

      assert.equal(
        conversationDelete.statusCode,
        404,
      );

      const messageDelete =
        await app.inject({
          method: "DELETE",
          url:
            `/api/v1/messages/${context.messageB}`,
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
        });

      assert.equal(
        messageDelete.statusCode,
        404,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            memberId,
          ),
        );

      await db
        .delete(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.userId,
            memberId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            memberId,
          ),
        );

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization owner can add an active member",
  async () => {
    const context =
      await createSecurityContext();

    const newUser =
      await createUser(
        `security-positive-member-${crypto.randomUUID()}@example.test`,
      );

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/memberships",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            organizationId:
              context.orgA,
            userId:
              newUser,
            role: "member",
          },
        });

      assert.equal(
        response.statusCode,
        201,
      );

      const membership =
        response.json().data;

      assert.equal(
        membership.organizationId,
        context.orgA,
      );

      assert.equal(
        membership.userId,
        newUser,
      );

      assert.equal(
        membership.role,
        "member",
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            newUser,
          ),
        );

      await db
        .delete(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.userId,
            newUser,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            newUser,
          ),
        );

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization member can create a project in their organization",
  async () => {
    const context =
      await createSecurityContext();

    const memberId =
      await createUser(
        `security-positive-project-member-${crypto.randomUUID()}@example.test`,
      );

    await db
      .insert(
        organizationMemberships,
      )
      .values({
        organizationId:
          context.orgA,
        userId: memberId,
        role: "member",
      });

    const session =
      await createSession(
        memberId,
      );

    const app =
      buildApp();

    let createdProjectId:
      | string
      | undefined;

    try {
      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/projects",
          headers: {
            cookie:
              `ak_vision_session=${session.token}`,
          },
          payload: {
            organizationId:
              context.orgA,
            name:
              "Authorized Member Project",
          },
        });

      assert.equal(
        response.statusCode,
        201,
      );

      const project =
        response.json().data;

      createdProjectId =
        project.id;

      assert.equal(
        project.organizationId,
        context.orgA,
      );

      assert.equal(
        project.ownerUserId,
        memberId,
      );
    } finally {
      await app.close();

      if (createdProjectId) {
        await db
          .delete(projects)
          .where(
            eq(
              projects.id,
              createdProjectId,
            ),
          );
      }

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            memberId,
          ),
        );

      await db
        .delete(
          organizationMemberships,
        )
        .where(
          eq(
            organizationMemberships.userId,
            memberId,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            memberId,
          ),
        );

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "project owner can update their project",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/projects/${context.projectA}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            name:
              "Updated Authorized Project",
            description:
              "Updated by project owner",
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const project =
        response.json().data;

      assert.equal(
        project.id,
        context.projectA,
      );

      assert.equal(
        project.name,
        "Updated Authorized Project",
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "conversation owner can update their conversation",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/conversations/${context.conversationA}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            title:
              "Updated Authorized Conversation",
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const conversation =
        response.json().data;

      assert.equal(
        conversation.id,
        context.conversationA,
      );

      assert.equal(
        conversation.title,
        "Updated Authorized Conversation",
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "authorized conversation user can create a message",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    let createdMessageId:
      | string
      | undefined;

    try {
      const response =
        await app.inject({
          method: "POST",
          url:
            "/api/v1/messages",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            conversationId:
              context.conversationA,
            role:
              "user",
            contentType:
              "text",
            content:
              "Authorized message",
          },
        });

      assert.equal(
        response.statusCode,
        201,
      );

      const message =
        response.json().data;

      createdMessageId =
        message.id;

      assert.equal(
        message.conversationId,
        context.conversationA,
      );

      assert.equal(
        message.role,
        "user",
      );

      assert.equal(
        message.content,
        "Authorized message",
      );
    } finally {
      await app.close();

      if (createdMessageId) {
        await db
          .delete(messages)
          .where(
            eq(
              messages.id,
              createdMessageId,
            ),
          );
      }

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization owner can transfer ownership to an existing active member",
  async () => {
    const context =
      await createSecurityContext();

    const newOwner =
      await createUser(
        `security-positive-new-owner-${crypto.randomUUID()}@example.test`,
      );

    await db
      .insert(
        organizationMemberships,
      )
      .values({
        organizationId:
          context.orgA,
        userId:
          newOwner,
        role:
          "member",
      });

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/organizations/${context.orgA}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            ownerUserId:
              newOwner,
          },
        });

      assert.equal(
        response.statusCode,
        200,
      );

      const organization =
        response.json().data;

      assert.equal(
        organization.ownerUserId,
        newOwner,
      );

      const memberships =
        await db
          .select({
            userId:
              organizationMemberships.userId,
            role:
              organizationMemberships.role,
          })
          .from(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.organizationId,
              context.orgA,
            ),
          );

      const oldOwner =
        memberships.find(
          (membership) =>
            membership.userId ===
            context.userA,
        );

      const currentOwner =
        memberships.find(
          (membership) =>
            membership.userId ===
            newOwner,
        );

      assert.equal(
        oldOwner?.role,
        "admin",
      );

      assert.equal(
        currentOwner?.role,
        "owner",
      );
    } finally {
      await app.close();

      await cleanupSecurityContext(
        context,
      );

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            newOwner,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            newOwner,
          ),
        );
    }
  },
);


test(
  "suspended user cannot access protected resources with an existing session",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      await db
        .update(users)
        .set({
          status: "suspended",
          updatedAt: new Date(),
        })
        .where(
          eq(
            users.id,
            context.userA,
          ),
        );

      const response =
        await app.inject({
          method: "GET",
          url:
            "/api/v1/projects",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        403,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization owner membership cannot be patched or deleted directly",
  async () => {
    const context =
      await createSecurityContext();

    const ownerMembershipResult =
      await db
        .select({
          id:
            organizationMemberships.id,
        })
        .from(
          organizationMemberships,
        )
        .where(
          and(
            eq(
              organizationMemberships.organizationId,
              context.orgA,
            ),
            eq(
              organizationMemberships.userId,
              context.userA,
            ),
          ),
        )
        .limit(1);

    const ownerMembership =
      ownerMembershipResult[0];

    assert.ok(
      ownerMembership,
    );

    const app =
      buildApp();

    try {
      const patch =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/memberships/${ownerMembership.id}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            role: "member",
          },
        });

      assert.equal(
        patch.statusCode,
        403,
      );

      const remove =
        await app.inject({
          method: "DELETE",
          url:
            `/api/v1/memberships/${ownerMembership.id}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        remove.statusCode,
        403,
      );

      const membershipCheck =
        await db
          .select({
            role:
              organizationMemberships.role,
          })
          .from(
            organizationMemberships,
          )
          .where(
            eq(
              organizationMemberships.id,
              ownerMembership.id,
            ),
          )
          .limit(1);

      assert.equal(
        membershipCheck[0]?.role,
        "owner",
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization owner cannot transfer ownership to a non-member",
  async () => {
    const context =
      await createSecurityContext();

    const outsider =
      await createUser(
        `security-outsider-${crypto.randomUUID()}@example.test`,
      );

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/organizations/${context.orgA}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            ownerUserId:
              outsider,
          },
        });

      assert.equal(
        response.statusCode,
        400,
      );

      const organization =
        await db
          .select({
            ownerUserId:
              organizations.ownerUserId,
          })
          .from(
            organizations,
          )
          .where(
            eq(
              organizations.id,
              context.orgA,
            ),
          )
          .limit(1);

      assert.equal(
        organization[0]?.ownerUserId,
        context.userA,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            outsider,
          ),
        );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            outsider,
          ),
        );

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization cannot lose its only owner through membership deletion",
  async () => {
    const context =
      await createSecurityContext();

    const ownerMembershipResult =
      await db
        .select({
          id:
            organizationMemberships.id,
        })
        .from(
          organizationMemberships,
        )
        .where(
          and(
            eq(
              organizationMemberships.organizationId,
              context.orgA,
            ),
            eq(
              organizationMemberships.userId,
              context.userA,
            ),
            eq(
              organizationMemberships.role,
              "owner",
            ),
          ),
        )
        .limit(1);

    const ownerMembership =
      ownerMembershipResult[0];

    assert.ok(
      ownerMembership,
    );

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "DELETE",
          url:
            `/api/v1/memberships/${ownerMembership.id}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        403,
      );

      const organization =
        await db
          .select({
            ownerUserId:
              organizations.ownerUserId,
          })
          .from(
            organizations,
          )
          .where(
            eq(
              organizations.id,
              context.orgA,
            ),
          )
          .limit(1);

      assert.equal(
        organization[0]?.ownerUserId,
        context.userA,
      );

      const ownerMembershipAfter =
        await db
          .select({
            userId:
              organizationMemberships.userId,
            role:
              organizationMemberships.role,
          })
          .from(
            organizationMemberships,
          )
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                context.orgA,
              ),
              eq(
                organizationMemberships.role,
                "owner",
              ),
            ),
          );

      assert.equal(
        ownerMembershipAfter.length,
        1,
      );

      assert.equal(
        ownerMembershipAfter[0]?.userId,
        context.userA,
      );
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "organization ownerUserId always matches its owner membership after ownership transfer",
  async () => {
    const context =
      await createSecurityContext();

    const newOwner =
      await createUser(
        `security-consistency-owner-${crypto.randomUUID()}@example.test`,
      );

    await db
      .insert(
        organizationMemberships,
      )
      .values({
        organizationId:
          context.orgA,
        userId:
          newOwner,
        role:
          "member",
      });

    const app =
      buildApp();

    try {
      const transfer =
        await app.inject({
          method: "PATCH",
          url:
            `/api/v1/organizations/${context.orgA}`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {
            ownerUserId:
              newOwner,
          },
        });

      assert.equal(
        transfer.statusCode,
        200,
      );

      const organization =
        await db
          .select({
            ownerUserId:
              organizations.ownerUserId,
          })
          .from(
            organizations,
          )
          .where(
            eq(
              organizations.id,
              context.orgA,
            ),
          )
          .limit(1);

      const ownerMemberships =
        await db
          .select({
            userId:
              organizationMemberships.userId,
            role:
              organizationMemberships.role,
          })
          .from(
            organizationMemberships,
          )
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                context.orgA,
              ),
              eq(
                organizationMemberships.role,
                "owner",
              ),
            ),
          );

      assert.equal(
        ownerMemberships.length,
        1,
      );

      assert.equal(
        organization[0]?.ownerUserId,
        newOwner,
      );

      assert.equal(
        ownerMemberships[0]?.userId,
        organization[0]?.ownerUserId,
      );
    } finally {
      await app.close();

      await db
        .delete(authSessions)
        .where(
          eq(
            authSessions.userId,
            newOwner,
          ),
        );

      await cleanupSecurityContext(
        context,
      );

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            newOwner,
          ),
        );
    }
  },
);

test(
  "invalid UUID is rejected by runtime validation with standardized error response",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      const response =
        await app.inject({
          method: "GET",
          url:
            "/api/v1/projects/not-a-uuid",
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
        });

      assert.equal(
        response.statusCode,
        400,
      );

      const body =
        response.json();

      assert.equal(
        body.status,
        "error",
      );

      assert.equal(
        body.code,
        "VALIDATION_ERROR",
      );

      assert.equal(
        typeof body.message,
        "string",
      );

      assert.equal(
        typeof body.requestId,
        "string",
      );
    } finally {
      await app.close();

      await cleanupSecurityContext(
        context,
      );
    }
  },
);

test(
  "credit reservation consume is denied across users",
  async () => {
    const context =
      await createSecurityContext();

    const app =
      buildApp();

    try {
      await addCredits({
        userId: context.userA,
        amount: 100,
        source: "purchase",
        idempotencyKey:
          `security-consume-grant-${crypto.randomUUID()}`,
        description:
          "Security consume test funding",
      });

      const reservation =
        await reserveCredit({
          userId: context.userA,
          amount: 25,
          idempotencyKey:
            `security-consume-reservation-${crypto.randomUUID()}`,
          referenceId:
            `security-consume-${crypto.randomUUID()}`,
        });

      const denied =
        await app.inject({
          method: "POST",
          url:
            `/api/v1/credits/reservations/${reservation.id}/consume`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenB}`,
          },
          payload: {},
        });

      assert.equal(
        denied.statusCode,
        409,
      );

      const afterDenied =
        await db
          .select({
            status:
              creditReservations.status,
          })
          .from(
            creditReservations,
          )
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          )
          .limit(1);

      assert.equal(
        afterDenied[0]?.status,
        "reserved",
      );

      const ownerResponse =
        await app.inject({
          method: "POST",
          url:
            `/api/v1/credits/reservations/${reservation.id}/consume`,
          headers: {
            cookie:
              `ak_vision_session=${context.tokenA}`,
          },
          payload: {},
        });

      assert.equal(
        ownerResponse.statusCode,
        200,
      );

      const afterOwnerConsume =
        await db
          .select({
            status:
              creditReservations.status,
          })
          .from(
            creditReservations,
          )
          .where(
            eq(
              creditReservations.id,
              reservation.id,
            ),
          )
          .limit(1);

      assert.equal(
        afterOwnerConsume[0]?.status,
        "consumed",
      );

      const balances =
        await db
          .select({
            id:
              creditBalances.id,
          })
          .from(
            creditBalances,
          )
          .where(
            eq(
              creditBalances.userId,
              context.userA,
            ),
          );

      for (const balance of balances) {
        await db
          .delete(creditTransactions)
          .where(
            eq(
              creditTransactions.creditBalanceId,
              balance.id,
            ),
          );

        await db
          .delete(creditReservations)
          .where(
            eq(
              creditReservations.creditBalanceId,
              balance.id,
            ),
          );

        await db
          .delete(creditBalances)
          .where(
            eq(
              creditBalances.id,
              balance.id,
            ),
          );
      }
    } finally {
      await app.close();
      await cleanupSecurityContext(
        context,
      );
    }
  },
);
