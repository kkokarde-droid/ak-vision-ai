import type { ID, ISODateString } from "./common.js";

export type AutomationTriggerType =
  | "manual"
  | "schedule"
  | "webhook"
  | "event"
  | "ai";

export type AutomationStatus =
  | "draft"
  | "active"
  | "paused"
  | "failed"
  | "archived";

export type AutomationStepType =
  | "ai"
  | "tool"
  | "condition"
  | "transform"
  | "notification"
  | "delay"
  | "human-approval";

export interface AutomationWorkflow {
  id: ID;
  organizationId: ID;
  ownerUserId: ID;
  name: string;
  description?: string;
  triggerType: AutomationTriggerType;
  status: AutomationStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AutomationStep {
  id: ID;
  workflowId: ID;
  name: string;
  type: AutomationStepType;
  order: number;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AutomationRun {
  id: ID;
  workflowId: ID;
  triggeredByUserId?: ID;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
}

export interface AutomationStepRun {
  id: ID;
  runId: ID;
  stepId: ID;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
}
