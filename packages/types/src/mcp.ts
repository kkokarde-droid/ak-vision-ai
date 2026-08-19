import type { ID, ISODateString } from "./common.js";

export type MCPConnectionStatus =
  | "connected"
  | "disconnected"
  | "expired"
  | "error"
  | "pending";

export type MCPAuthType =
  | "oauth2"
  | "api-key"
  | "bearer-token"
  | "basic"
  | "custom";

export type MCPActionRisk =
  | "read"
  | "write"
  | "delete"
  | "financial"
  | "external-communication";

export interface MCPConnector {
  id: ID;
  name: string;
  displayName: string;
  description?: string;
  authType: MCPAuthType;
  enabled: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MCPTool {
  id: ID;
  connectorId: ID;
  name: string;
  displayName: string;
  description: string;
  risk: MCPActionRisk;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  enabled: boolean;
}

export interface MCPConnection {
  id: ID;
  connectorId: ID;
  userId: ID;
  organizationId?: ID;
  status: MCPConnectionStatus;
  scopes: string[];
  expiresAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MCPToolExecution {
  id: ID;
  connectionId: ID;
  toolId: ID;
  requestId?: ID;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  startedAt: ISODateString;
  completedAt?: ISODateString;
}
