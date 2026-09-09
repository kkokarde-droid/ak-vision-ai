import type { FastifyInstance } from "fastify";

import {
  CreditRepositoryError,
} from "@ak-vision-ai/credits";

import {
  consumeOwnedCreditReservation,
  getCredits,
  releaseOwnedCreditReservation,
  reserveCredit,
} from "@ak-vision-ai/credits";

import {
  ReservationActionBodySchema,
  ReservationIdParamsSchema,
  ReserveCreditsBodySchema,
} from "./credits.schemas.js";

import {
  authenticate,
} from "../../common/auth/auth.guard.js";

import {
  getOrganizationAccess,
} from "../../common/auth/organization-access.js";

function mapCreditError(
  error: unknown,
) {
  if (
    error instanceof CreditRepositoryError
  ) {
    switch (error.code) {
      case "INVALID_OWNER":
      case "INVALID_AMOUNT":
        return {
          statusCode: 400,
          code: "BAD_REQUEST",
          message: error.message,
        };

      case "INSUFFICIENT_CREDITS":
        return {
          statusCode: 409,
          code: "INSUFFICIENT_CREDITS",
          message: error.message,
        };

      case "IDEMPOTENCY_CONFLICT":
        return {
          statusCode: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: error.message,
        };

      case "INVALID_STATE":
        return {
          statusCode: 409,
          code: "INVALID_STATE",
          message: error.message,
        };

      case "NOT_FOUND":
        return {
          statusCode: 404,
          code: "NOT_FOUND",
          message: error.message,
        };
    }
  }

  return null;
}

async function authorizeOrganizationOwner(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const access =
    await getOrganizationAccess(
      userId,
      organizationId,
    );

  return Boolean(access);
}

export async function creditsRoutes(
  app: FastifyInstance,
) {
  app.addHook(
    "preHandler",
    authenticate,
  );

  /**
   * GET /api/v1/credits
   *
   * Returns the authenticated user's
   * individual credit balance.
   */
  app.get(
    "/",
    async (request, reply) => {
      const actor = request.auth;

      if (!actor) {
        return reply.code(401).send({
          status: "error",
          code: "UNAUTHORIZED",
          message:
            "Authentication required",
        });
      }

      try {
        const balance =
          await getCredits({
            userId: actor.userId,
          });

        return {
          status: "ok",
          data: balance,
        };
      } catch (error) {
        const mapped =
          mapCreditError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );

  /**
   * GET /api/v1/credits/organizations/:organizationId
   *
   * Returns an organization's credit balance.
   *
   * Membership/access is always derived from the
   * authenticated actor.
   */
  app.get<{
    Params: {
      organizationId: string;
    };
  }>(
    "/organizations/:organizationId",
    async (request, reply) => {
      const actor = request.auth;

      if (!actor) {
        return reply.code(401).send({
          status: "error",
          code: "UNAUTHORIZED",
          message:
            "Authentication required",
        });
      }

      const allowed =
        await authorizeOrganizationOwner(
          actor.userId,
          request.params.organizationId,
        );

      if (!allowed) {
        return reply.code(403).send({
          status: "error",
          code: "FORBIDDEN",
          message:
            "Organization credit access denied",
        });
      }

      try {
        const balance =
          await getCredits({
            organizationId:
              request.params.organizationId,
          });

        return {
          status: "ok",
          data: balance,
        };
      } catch (error) {
        const mapped =
          mapCreditError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );

  /**
   * POST /api/v1/credits/reservations
   *
   * Reserves credits for an authenticated
   * user's in-progress operation.
   *
   * Customer input cannot choose userId.
   */
  app.post(
    "/reservations",
    {
      schema: {
        body: ReserveCreditsBodySchema,
      },
    },
    async (request, reply) => {
      const actor = request.auth;

      if (!actor) {
        return reply.code(401).send({
          status: "error",
          code: "UNAUTHORIZED",
          message:
            "Authentication required",
        });
      }
      const body =
        request.body as {
          amount: number;
          referenceId?: string;
          idempotencyKey: string;
          expiresAt?: string;
        };

      /*
       * Customer-facing reservations are always owned by
       * the authenticated user. Organization credit
       * reservations remain trusted internal operations.
       */
      const owner = {
        userId: actor.userId,
      };

      try {
        const reservation =
          await reserveCredit({
  amount: body.amount,
  idempotencyKey: body.idempotencyKey,
  ...(body.referenceId !== undefined
    ? { referenceId: body.referenceId }
    : {}),
  ...(body.expiresAt !== undefined
    ? { expiresAt: new Date(body.expiresAt) }
    : {}),
  ...owner,
});

        return reply.code(201).send({
          status: "ok",
          data: reservation,
        });
      } catch (error) {
        const mapped =
          mapCreditError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );

  /**
   * POST
   * /api/v1/credits/reservations/:reservationId/consume
   */
  app.post<{
    Params: {
      reservationId: string;
    };
    Body: {
      referenceId?: string;
    };
  }>(
    "/reservations/:reservationId/consume",
    {
      schema: {
        params:
          ReservationIdParamsSchema,
        body:
          ReservationActionBodySchema,
      },
    },
    async (request, reply) => {
      if (!request.auth) {
        return reply.code(401).send({
          status: "error",
          code: "UNAUTHORIZED",
          message:
            "Authentication required",
        });
      }

      try {
        const result =
          await consumeOwnedCreditReservation(
            {
              reservationId:
                request.params.reservationId,
              ...(request.body.referenceId !== undefined
                ? {
                    referenceId:
                      request.body.referenceId,
                  }
                : {}),
            },
            {
              userId:
                request.auth.userId,
            },
          );

        return {
          status: "ok",
          data: result,
        };
      } catch (error) {
        const mapped =
          mapCreditError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );

  /**
   * POST
   * /api/v1/credits/reservations/:reservationId/release
   */
  app.post<{
    Params: {
      reservationId: string;
    };
    Body: {
      referenceId?: string;
    };
  }>(
    "/reservations/:reservationId/release",
    {
      schema: {
        params:
          ReservationIdParamsSchema,
        body:
          ReservationActionBodySchema,
      },
    },
    async (request, reply) => {
      if (!request.auth) {
        return reply.code(401).send({
          status: "error",
          code: "UNAUTHORIZED",
          message:
            "Authentication required",
        });
      }

      try {
        const result =
          await releaseOwnedCreditReservation(
  {
    reservationId:
      request.params.reservationId,
    ...(request.body.referenceId !== undefined
      ? {
          referenceId:
            request.body.referenceId,
        }
      : {}),
  },
  {
    userId:
      request.auth.userId,
  },
);

        return {
          status: "ok",
          data: result,
        };
      } catch (error) {
        const mapped =
          mapCreditError(error);

        if (mapped) {
          return reply
            .code(mapped.statusCode)
            .send({
              status: "error",
              code: mapped.code,
              message: mapped.message,
            });
        }

        throw error;
      }
    },
  );
}

