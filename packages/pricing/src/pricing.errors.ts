export type PricingErrorCode =
  | "INVALID_INPUT"
  | "PRICING_NOT_FOUND"
  | "PRICING_CONFLICT"
  | "UNSUPPORTED_CURRENCY";

export class PricingError extends Error {
  public readonly code: PricingErrorCode;

  constructor(
    message: string,
    code: PricingErrorCode,
  ) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}
