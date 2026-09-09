import { Type } from "@sinclair/typebox";

export const RegisterBodySchema =
  Type.Object({
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      format: "email",
    }),

    password: Type.String({
      minLength: 12,
      maxLength: 128,
    }),

    displayName: Type.String({
      minLength: 1,
      maxLength: 120,
    }),

    accountType: Type.Optional(
      Type.Union([
        Type.Literal("individual"),
        Type.Literal("business"),
        Type.Literal("enterprise"),
      ]),
    ),
  });

export const LoginBodySchema =
  Type.Object({
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      format: "email",
    }),

    password: Type.String({
      minLength: 1,
      maxLength: 128,
    }),
  });
