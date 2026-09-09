import { Type } from "@sinclair/typebox";

export const UserRoleSchema =
  Type.Union([
    Type.Literal("customer"),
    Type.Literal("admin"),
    Type.Literal("super_admin"),
  ]);

export const UserStatusSchema =
  Type.Union([
    Type.Literal("pending"),
    Type.Literal("active"),
    Type.Literal("suspended"),
  ]);

export const AccountTypeSchema =
  Type.Union([
    Type.Literal("individual"),
    Type.Literal("business"),
    Type.Literal("enterprise"),
  ]);

export const CreateUserBodySchema =
  Type.Object({
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      format: "email",
    }),

    displayName: Type.String({
      minLength: 1,
      maxLength: 120,
    }),

    role: Type.Optional(
      UserRoleSchema,
    ),

    status: Type.Optional(
      UserStatusSchema,
    ),

    accountType: Type.Optional(
      AccountTypeSchema,
    ),
  });

export const UpdateUserBodySchema =
  Type.Object({
    email: Type.Optional(
      Type.String({
        minLength: 3,
        maxLength: 320,
        format: "email",
      }),
    ),

    displayName: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
      }),
    ),

    role: Type.Optional(
      UserRoleSchema,
    ),

    status: Type.Optional(
      UserStatusSchema,
    ),

    accountType: Type.Optional(
      AccountTypeSchema,
    ),
  });

export const UserIdParamSchema =
  Type.Object({
    id: Type.String({
      format: "uuid",
    }),
  });
