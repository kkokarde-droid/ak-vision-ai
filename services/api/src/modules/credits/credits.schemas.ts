import {
  Type,
  type Static,
} from "@sinclair/typebox";

/**
 * Supported currencies.
 */
const CurrencySchema = Type.Union([
  Type.Literal("INR"),
  Type.Literal("USD"),
  Type.Literal("EUR"),
  Type.Literal("GBP"),
]);

/**
 * A credit account must belong to exactly one owner.
 *
 * This is intentionally modeled as a union so the API contract
 * cannot represent a user + organization account at the same time.
 */
const CreditAccountOwnerSchema = Type.Union([
  Type.Object({
    userId: Type.String({
      format: "uuid",
      minLength: 1,
    }),
    organizationId: Type.Null(),
  }),
  Type.Object({
    userId: Type.Null(),
    organizationId: Type.String({
      format: "uuid",
      minLength: 1,
    }),
  }),
]);

/**
 * Trusted/internal/admin credit grant.
 *
 * This schema MUST NOT be exposed as a normal customer mutation.
 */
export const AddCreditsBodySchema =
  Type.Intersect([
    CreditAccountOwnerSchema,
    Type.Object({
      amount: Type.Integer({
        minimum: 1,
      }),

      source: Type.Union([
        Type.Literal("free"),
        Type.Literal("purchase"),
        Type.Literal("subscription"),
        Type.Literal("promotion"),
        Type.Literal("refund"),
        Type.Literal("admin"),
        Type.Literal("system"),
      ]),

      referenceId: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 255,
        }),
      ),

      idempotencyKey: Type.String({
        minLength: 1,
        maxLength: 255,
      }),

      description: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 500,
        }),
      ),

      currency: Type.Optional(
        CurrencySchema,
      ),
    }),
  ]);

export type AddCreditsBody = Static<
  typeof AddCreditsBodySchema
>;

/**
 * Credit reservation request.
 *
 * Identity should normally be derived from authenticated
 * tenant context. The explicit owner fields are retained here
 * for trusted service/internal use and will be ignored/rejected
 * by customer-facing routes when appropriate.
 */
export const ReserveCreditsBodySchema =
  Type.Object({
    amount: Type.Integer({
      minimum: 1,
    }),

    referenceId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 255,
      }),
    ),

    idempotencyKey: Type.String({
      minLength: 1,
      maxLength: 255,
    }),

    expiresAt: Type.Optional(
      Type.String({
        format: "date-time",
      }),
    ),
  });

export type ReserveCreditsBody = Static<
  typeof ReserveCreditsBodySchema
>;

export const ReservationIdParamsSchema =
  Type.Object({
    reservationId: Type.String({
      format: "uuid",
      minLength: 1,
    }),
  });

export type ReservationIdParams = Static<
  typeof ReservationIdParamsSchema
>;

export const ReservationActionBodySchema =
  Type.Object({
    referenceId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 255,
      }),
    ),
  });

export type ReservationActionBody = Static<
  typeof ReservationActionBodySchema
>;

/**
 * Customer/request-level usage input.
 *
 * IMPORTANT:
 * - no userId
 * - no organizationId
 * - no provider cost
 * - no customer charge
 * - no platform contribution
 *
 * Those values are trusted/server-generated values.
 */
export const UsageRecordBodySchema =
  Type.Object({
    requestId: Type.String({
      format: "uuid",
      minLength: 1,
    }),

    providerId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
      }),
    ),

    providerModelId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 150,
      }),
    ),

    creditsUsed: Type.Integer({
      minimum: 0,
    }),
  });

export type UsageRecordBody = Static<
  typeof UsageRecordBodySchema
>;

/**
 * Trusted server-side settlement input.
 *
 * This schema is for internal service boundaries only.
 */
export const UsageSettlementSchema =
  Type.Object({
    requestId: Type.String({
      format: "uuid",
      minLength: 1,
    }),

    providerId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
      }),
    ),

    providerModelId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 150,
      }),
    ),

    creditsUsed: Type.Integer({
      minimum: 0,
    }),

    providerCostMinor: Type.Optional(
      Type.Integer({
        minimum: 0,
      }),
    ),

    infrastructureCostMinor: Type.Optional(
      Type.Integer({
        minimum: 0,
      }),
    ),

    retryCostMinor: Type.Optional(
      Type.Integer({
        minimum: 0,
      }),
    ),

    customerChargeMinor: Type.Optional(
      Type.Integer({
        minimum: 0,
      }),
    ),

    platformContributionMinor:
      Type.Optional(
        Type.Integer({
          minimum: 0,
        }),
      ),

    currency: CurrencySchema,
  });

export type UsageSettlement = Static<
  typeof UsageSettlementSchema
>;
