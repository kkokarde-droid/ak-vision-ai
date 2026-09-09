import { Type } from "@sinclair/typebox";

export const ProjectTypeSchema = Type.Union([
  Type.Literal("general"),
  Type.Literal("research"),
  Type.Literal("coding"),
  Type.Literal("website"),
  Type.Literal("mobile-app"),
  Type.Literal("image"),
  Type.Literal("video"),
  Type.Literal("audio"),
  Type.Literal("business"),
  Type.Literal("erp"),
  Type.Literal("crm"),
  Type.Literal("automation"),
]);

export const ProjectStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("archived"),
  Type.Literal("deleted"),
]);

export const CreateProjectBodySchema =
  Type.Object({
    organizationId: Type.String({
      format: "uuid",
    }),

    name: Type.String({
      minLength: 1,
      maxLength: 200,
    }),

    description: Type.Optional(
      Type.String({
        maxLength: 10000,
      }),
    ),

    type: Type.Optional(
      ProjectTypeSchema,
    ),

    status: Type.Optional(
      ProjectStatusSchema,
    ),
  });

export const UpdateProjectBodySchema =
  Type.Object({
    name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
      }),
    ),

    description: Type.Optional(
      Type.Union([
        Type.String({
          maxLength: 10000,
        }),
        Type.Null(),
      ]),
    ),

    type: Type.Optional(
      ProjectTypeSchema,
    ),

    status: Type.Optional(
      ProjectStatusSchema,
    ),

    ownerUserId: Type.Optional(
      Type.String({
        format: "uuid",
      }),
    ),
  });
