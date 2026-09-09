import { Type } from "@sinclair/typebox";

export const MembershipRoleSchema =
  Type.Union([
    Type.Literal("owner"),
    Type.Literal("admin"),
    Type.Literal("member"),
    Type.Literal("billing"),
  ]);

export const CreateMembershipBodySchema =
  Type.Object({
    organizationId: Type.String({
      format: "uuid",
    }),

    userId: Type.String({
      format: "uuid",
    }),

    role: Type.Optional(
      MembershipRoleSchema,
    ),
  });

export const UpdateMembershipBodySchema =
  Type.Object({
    role: MembershipRoleSchema,
  });

export const MembershipIdParamSchema =
  Type.Object({
    id: Type.String({
      format: "uuid",
    }),
  });
