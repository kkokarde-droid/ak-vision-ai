import type { ID, ISODateString } from "./common.js";

export type KnowledgeSourceType =
  | "file"
  | "url"
  | "website"
  | "database"
  | "mcp"
  | "manual";

export type KnowledgeSourceStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "disabled";

export type FileType =
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "audio"
  | "video"
  | "text"
  | "code"
  | "archive"
  | "other";

export interface KnowledgeSource {
  id: ID;
  organizationId: ID;
  ownerUserId: ID;
  projectId?: ID;
  name: string;
  type: KnowledgeSourceType;
  status: KnowledgeSourceStatus;
  uri?: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface KnowledgeFile {
  id: ID;
  knowledgeSourceId: ID;
  fileName: string;
  fileType: FileType;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  checksum?: string;
  createdAt: ISODateString;
}

export interface KnowledgeChunk {
  id: ID;
  knowledgeSourceId: ID;
  fileId?: ID;
  content: string;
  chunkIndex: number;
  tokenCount?: number;
  embeddingModel?: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
}

export interface ResearchJob {
  id: ID;
  userId: ID;
  organizationId?: ID;
  projectId?: ID;
  query: string;
  status:
    | "queued"
    | "researching"
    | "synthesizing"
    | "completed"
    | "failed"
    | "cancelled";
  depth: "quick" | "standard" | "deep";
  resultArtifactId?: ID;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
}

export interface ResearchSource {
  id: ID;
  researchJobId: ID;
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  content?: string;
  publishedAt?: ISODateString;
  accessedAt: ISODateString;
  credibilityScore?: number;
}
