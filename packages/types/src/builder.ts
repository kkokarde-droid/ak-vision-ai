import type { ID, ISODateString } from "./common.js";
import type { ArtifactType } from "./artifact.js";

export type BuilderType =
  | "website"
  | "webpage"
  | "mobile-app"
  | "desktop-app";

export type BuilderStatus =
  | "draft"
  | "generating"
  | "ready"
  | "failed"
  | "published";

export type BuilderFramework =
  | "html-css-js"
  | "react"
  | "nextjs"
  | "react-native"
  | "flutter"
  | "native-android"
  | "native-ios";

export interface BuilderProject {
  id: ID;
  projectId: ID;
  ownerUserId: ID;
  organizationId?: ID;
  name: string;
  type: BuilderType;
  framework: BuilderFramework;
  status: BuilderStatus;
  artifactId?: ID;
  previewUrl?: string;
  publishedUrl?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface BuilderGeneration {
  id: ID;
  builderProjectId: ID;
  prompt: string;
  requirements?: Record<string, unknown>;
  generatedArtifactType: ArtifactType;
  status: BuilderStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
