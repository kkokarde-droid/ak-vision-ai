import { Type } from "@sinclair/typebox";

export const CreateOrganizationBodySchema =
  Type.Object({
    name: Type.String({
      minLength: 1,
      maxLength: 200,
    }),
  });

export const UpdateOrganizationBodySchema =
  Type.Object({
    name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
      }),
    ),

    ownerUserId: Type.Optional(
      Type.String({
        format: "uuid",
      }),
    ),
  });

export const OrganizationIdParamSchema =
  Type.Object({
    id: Type.String({
      format: "uuid",
    }),
  });
