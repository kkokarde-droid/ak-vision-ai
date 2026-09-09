export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    expose = true,
  ) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
  }

  static badRequest(
    message: string,
  ) {
    return new ApiError(
      400,
      "BAD_REQUEST",
      message,
    );
  }

  static unauthorized(
    message = "Authentication required",
  ) {
    return new ApiError(
      401,
      "UNAUTHORIZED",
      message,
    );
  }

  static forbidden(
    message = "Insufficient permissions",
  ) {
    return new ApiError(
      403,
      "FORBIDDEN",
      message,
    );
  }

  static notFound(
    message = "Resource not found",
  ) {
    return new ApiError(
      404,
      "NOT_FOUND",
      message,
    );
  }

  static conflict(
    message: string,
  ) {
    return new ApiError(
      409,
      "CONFLICT",
      message,
    );
  }
}
