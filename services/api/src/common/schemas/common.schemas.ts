import { Type } from "@sinclair/typebox";

export const UuidParamSchema = Type.Object({
  id: Type.String({
    format: "uuid",
  }),
});

export const PaginationQuerySchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      default: 20,
    }),
  ),

  offset: Type.Optional(
    Type.Integer({
      minimum: 0,
      default: 0,
    }),
  ),

  order: Type.Optional(
    Type.Union([
      Type.Literal("asc"),
      Type.Literal("desc"),
    ]),
  ),
});