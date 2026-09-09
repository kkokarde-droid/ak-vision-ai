import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  ApiError,
} from "./api-error.js";

type ValidationIssue = {
  instancePath?: string;
  keyword?: string;
  message?: string;
  params?: unknown;
};

type ValidationErrorShape = {
  validation?: ValidationIssue[];
  validationContext?: string;
};

type ErrorShape = {
  message?: string;
  statusCode?: number;
};

function asErrorShape(
  error: unknown,
): ErrorShape {
  if (
    typeof error === "object" &&
    error !== null
  ) {
    return error as ErrorShape;
  }

  return {};
}

function getValidation(
  error: unknown,
): ValidationIssue[] | null {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return null;
  }

  const value =
    error as ValidationErrorShape;

  return Array.isArray(
    value.validation,
  )
    ? value.validation
    : null;
}

function formatValidationMessage(
  validation: ValidationIssue[],
): string {
  const first =
    validation[0];

  if (!first) {
    return "Request validation failed";
  }

  if (first.message) {
    return `Request validation failed: ${first.message}`;
  }

  return "Request validation failed";
}

export function registerErrorHandler(
  app: FastifyInstance,
) {
  app.setErrorHandler(
    async (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const requestId =
        request.id;

      const validation =
        getValidation(error);

      if (validation) {
        return reply
          .code(400)
          .send({
            status: "error",
            code:
              "VALIDATION_ERROR",
            message:
              formatValidationMessage(
                validation,
              ),
            requestId,
          });
      }

      if (
        error instanceof ApiError
      ) {
        return reply
          .code(error.statusCode)
          .send({
            status: "error",
            code: error.code,
            message: error.expose
              ? error.message
              : "Internal server error",
            requestId,
          });
      }

      const safeError =
        asErrorShape(error);

      const statusCode =
        typeof safeError.statusCode ===
        "number"
          ? safeError.statusCode
          : 500;

      if (statusCode >= 500) {
        request.log.error(
          {
            err: error,
            requestId,
          },
          "Unhandled API error",
        );

        return reply
          .code(500)
          .send({
            status: "error",
            code:
              "INTERNAL_ERROR",
            message:
              "Internal server error",
            requestId,
          });
      }

      return reply
        .code(statusCode)
        .send({
          status: "error",
          code:
            statusCode === 404
              ? "NOT_FOUND"
              : statusCode === 403
                ? "FORBIDDEN"
                : statusCode === 401
                  ? "UNAUTHORIZED"
                  : "BAD_REQUEST",
          message:
            safeError.message ??
            "Request failed",
          requestId,
        });
    },
  );
}
