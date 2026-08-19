export type ID = string;

export type ISODateString = string;

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

export type Environment = "development" | "staging" | "production";

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: ApiError;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
