import { randomUUID } from "node:crypto";
import {
  add,
  and,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import {
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
  usageRecords,
  users,
} from "@ak-vision-ai/database";
import {
  CreditRepositoryError,
  getCredits,
  grantCredits,
} from "@ak-vision-ai/credits";
import {
  authenticate,
  requireRole,
} from "../../common/auth/auth.guard.js";

const ListQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    search: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);

const UserIdParamsSchema = Type.Object(
  { userId: Type.String({ format: "uuid" }) },
);

const GrantBodySchema = Type.Object(
  {
    amount: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    referenceId: Type.Optional(Type.String({ maxLength: 255 })),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 255 }),
  },
  { additionalProperties: false },
);

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function customerCondition(search?: string) {
  const conditions = [eq(users.role, "customer")];
  const needle = search?.trim();
  if (needle) {
    const pattern = `%${needle}%`;
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.displayName, pattern),
      )!,
    );
  }
  return and(...conditions);
}

function serializeCustomer(
  user: typeof users.$inferSelect,
  balance: typeof creditBalances.$inferSelect | null,
) {
  return {
    customer: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      accountType: user.accountType,
    },
    balance: balance
      ? {
          id: balance.id,
          availableCredits: balance.availableCredits,
          reservedCredits: balance.reservedCredits,
          currency: balance.currency,
          updatedAt: balance.updatedAt.toISOString(),
        }
      : null,
    totalCredits: balance
      ? balance.availableCredits + balance.reservedCredits
      : 0,
  };
}

function serializeTransaction(
  row: typeof creditTransactions.$inferSelect,
) {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    amount: row.amount,
    availableBalanceAfter: row.availableBalanceAfter,
    reservedBalanceAfter: row.reservedBalanceAfter,
    referenceId: row.referenceId ?? null,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeReservation(
  row: typeof creditReservations.$inferSelect,
) {
  return {
    id: row.id,
    amount: row.amount,
    status: row.status,
    referenceId: row.referenceId ?? null,
    expiresAt: iso(row.expiresAt),
    releasedAt: iso(row.releasedAt),
    consumedAt: iso(row.consumedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeUsage(
  row: typeof usageRecords.$inferSelect,
) {
  return {
    id: row.id,
    requestId: row.requestId,
    providerId: row.providerId ?? null,
    providerModelId: row.providerModelId ?? null,
    creditsUsed: row.creditsUsed,
    providerCostMinor: row.providerCostMinor ?? null,
    infrastructureCostMinor: row.infrastructureCostMinor ?? null,
    retryCostMinor: row.retryCostMinor ?? null,
    customerChargeMinor: row.customerChargeMinor ?? null,
    platformContributionMinor: row.platformContributionMinor ?? null,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function adminCreditsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("admin", "super_admin"));

  app.get<{ Querystring: { page?: number; pageSize?: number; search?: string } }>(
    "/",
    { schema: { querystring: ListQuerySchema } },
    async (request) => {
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 25;
      const offset = (page - 1) * pageSize;
      const where = customerCondition(request.query.search);

      const totalResult = await db
        .select({ count: count() })
        .from(users)
        .where(where);
      const total = Number(totalResult[0]?.count ?? 0);

      const rows = await db
        .select({ user: users, balance: creditBalances })
        .from(users)
        .leftJoin(
          creditBalances,
          and(
            eq(creditBalances.userId, users.id),
            isNull(creditBalances.organizationId),
          ),
        )
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset);

      return {
        status: "ok",
        data: rows.map(({ user, balance }) => ({
          id: user.id,
          ...serializeCustomer(user, balance),
        })),
        meta: {
          page,
          pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        },
      };
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/:userId",
    { schema: { params: UserIdParamsSchema } },
    async (request, reply) => {
      const result = await db
        .select({ user: users, balance: creditBalances })
        .from(users)
        .leftJoin(
          creditBalances,
          and(
            eq(creditBalances.userId, users.id),
            isNull(creditBalances.organizationId),
          ),
        )
        .where(
          and(
            eq(users.id, request.params.userId),
            eq(users.role, "customer"),
          ),
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        return reply.code(404).send({
          status: "error",
          message: "Customer not found",
        });
      }

      const [transactions, reservations, usage] = await Promise.all([
        db
          .select()
          .from(creditTransactions)
          .where(eq(creditTransactions.userId, row.user.id))
          .orderBy(desc(creditTransactions.createdAt))
          .limit(50),
        db
          .select()
          .from(creditReservations)
          .where(eq(creditReservations.userId, row.user.id))
          .orderBy(desc(creditReservations.createdAt))
          .limit(50),
        db
          .select()
          .from(usageRecords)
          .where(eq(usageRecords.userId, row.user.id))
          .orderBy(desc(usageRecords.createdAt))
          .limit(50),
      ]);

      return {
        status: "ok",
        data: {
          id: row.user.id,
          ...serializeCustomer(row.user, row.balance),
          transactions: transactions.map(serializeTransaction),
          reservations: reservations.map(serializeReservation),
          usage: usage.map(serializeUsage),
        },
      };
    },
  );

  app.post<{
    Params: { userId: string };
    Body: {
      amount: number;
      description?: string;
      referenceId?: string;
      idempotencyKey: string;
    };
  }>(
    "/:userId/grant",
    { schema: { params: UserIdParamsSchema, body: GrantBodySchema } },
    async (request, reply) => {
      const actor = request.auth;
      if (!actor) {
        return reply.code(401).send({
          status: "error",
          message: "Authentication required",
        });
      }

      const targetResult = await db
        .select({
          id: users.id,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, request.params.userId))
        .limit(1);

      const target = targetResult[0];
      if (!target || target.role !== "customer") {
        return reply.code(404).send({
          status: "error",
          message: "Customer not found",
        });
      }

      const idempotencyKey = request.body.idempotencyKey.trim();
      const providedReferenceId = request.body.referenceId?.trim();
      const referenceId =
        providedReferenceId
          ? `admin:${actor.userId}:${providedReferenceId}`
          : `admin:${actor.userId}:${randomUUID()}`;
      const rawDescription = request.body.description?.trim();
      const description =
        rawDescription
          ? `Admin grant: ${rawDescription}`
          : "Admin credit grant";

      try {
        const transaction = await grantCredits({
          userId: target.id,
          amount: request.body.amount,
          source: "admin",
          referenceId,
          idempotencyKey,
          description,
        });

        const balance = await getCredits({
          userId: target.id,
        });

        if (!balance) {
          throw new Error("Credit balance not found after grant.");
        }

        return reply.code(200).send({
          status: "ok",
          data: {
            transaction: serializeTransaction(transaction),
            balance: {
              availableCredits: balance.availableCredits,
              reservedCredits: balance.reservedCredits,
              currency: balance.currency,
            },
          },
        });
      } catch (error) {
        if (error instanceof CreditRepositoryError) {
          if (error.code === "IDEMPOTENCY_CONFLICT") {
            return reply.code(409).send({
              status: "error",
              message: error.message,
            });
          }
          if (
            error.code === "INVALID_AMOUNT" ||
            error.code === "INVALID_INPUT"
          ) {
            return reply.code(400).send({
              status: "error",
              message: error.message,
            });
          }
        }
        throw error;
      }
    },
  );
}
