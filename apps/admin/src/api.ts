export type UserRole = "customer" | "admin" | "super_admin";
export type UserStatus = "pending" | "active" | "suspended";
export type AccountType = "individual" | "business" | "enterprise";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  accountType: string;
  createdAt: string;
  updatedAt: string;
};

export type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  accountType: AccountType;
  createdAt: string;
  updatedAt: string;
};


export type GenerationStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type AdminGeneration = {
  id: string;
  requestId: string;
  userId: string;
  customer: {
    id: string;
    email: string;
    displayName: string;
  };
  type: string;
  status: GenerationStatus;
  priority: number | null;
  mode: string | null;
  providerId: string | null;
  providerModelId: string | null;
  progress: number;
  prompt: string | null;
  creditsRequired: number | null;
  outputCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type AdminGenerationOutput = {
  id: string;
  type: string;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminGenerationDetail = AdminGeneration & {
  inputSummary: Record<string, unknown> | null;
  outputs: AdminGenerationOutput[];
  errorCode: string | null;
  errorMessage: string | null;
};
type ErrorResponse = { status: "error"; message?: string };
const API_BASE = "/api/v1";

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new Error(error instanceof Error ? `Network error: ${error.message}` : "Network error while contacting the API.");
  }

  const rawBody = await response.text();
  let payload: T | ErrorResponse | null = null;
  if (rawBody.trim()) {
    try { payload = JSON.parse(rawBody) as T | ErrorResponse; } catch { payload = null; }
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getCurrentUser() {
  const response = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Could not restore the admin session.");
  const payload = (await response.json()) as { status: "ok"; data: AuthUser };
  return payload.data;
}

export async function login(email: string, password: string) {
  return request<{ status: "ok"; data: { user: AuthUser } }>(`${API_BASE}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return request<{ status: "ok"; message: string }>(`${API_BASE}/auth/logout`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getUsers() {
  return request<{ status: "ok"; data: ManagedUser[] }>(`${API_BASE}/users`);
}

export async function createUser(input: {
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  accountType: AccountType;
}) {
  return request<{ status: "ok"; data: ManagedUser }>(`${API_BASE}/users`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateUser(id: string, input: Partial<Omit<ManagedUser, "id" | "createdAt" | "updatedAt">>) {
  return request<{ status: "ok"; data: ManagedUser }>(`${API_BASE}/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteUser(id: string) {
  return request<{ status: "ok"; data: ManagedUser }>(`${API_BASE}/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

function normalizeAdminGeneration(row: any): AdminGeneration {
  const customer = row.customer ?? row.user ?? {};
  return {
    id: String(row.id ?? row.jobId ?? ""),
    requestId: String(row.requestId ?? ""),
    userId: String(row.userId ?? customer.id ?? ""),
    customer: {
      id: String(customer.id ?? row.userId ?? ""),
      email: String(customer.email ?? row.userEmail ?? "—"),
      displayName: String(customer.displayName ?? row.userDisplayName ?? row.userName ?? "—"),
    },
    type: String(row.type ?? "—"),
    status: String(row.status ?? "queued") as GenerationStatus,
    priority: row.priority == null ? null : Number(row.priority),
    mode: row.mode == null ? null : String(row.mode),
    providerId: row.providerId == null ? null : String(row.providerId),
    providerModelId: row.providerModelId == null ? null : String(row.providerModelId),
    progress: Number(row.progress ?? 0),
    prompt: row.prompt == null ? null : String(row.prompt),
    creditsRequired: row.creditsRequired == null ? null : Number(row.creditsRequired),
    outputCount: Number(row.outputCount ?? 0),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? row.createdAt ?? new Date().toISOString()),
    startedAt: row.startedAt == null ? null : String(row.startedAt),
    completedAt: row.completedAt == null ? null : String(row.completedAt),
  };
}

export async function getAdminGenerations(input: {
  page?: number;
  pageSize?: number;
  status?: GenerationStatus | "";
  search?: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page ?? 1));
  params.set("pageSize", String(input.pageSize ?? 20));
  if (input.status) params.set("status", input.status);
  if (input.search?.trim()) params.set("search", input.search.trim());

  const raw = await request<any>(
    API_BASE + "/admin/generations?" + params.toString()
  );

  const rows = Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.data?.items)
      ? raw.data.items
      : Array.isArray(raw?.items)
        ? raw.items
        : [];

  const metaSource = raw?.meta ?? raw?.data?.meta ?? {};
  const pageSize = Number(metaSource.pageSize ?? input.pageSize ?? 20);
  const total = Number(metaSource.total ?? rows.length);

  return {
    status: "ok" as const,
    data: rows.map(normalizeAdminGeneration),
    meta: {
      page: Number(metaSource.page ?? input.page ?? 1),
      pageSize,
      total,
      totalPages: Number(metaSource.totalPages ?? Math.max(1, Math.ceil(total / pageSize))),
    },
  };
}

export async function getAdminGeneration(jobId: string) {
  const raw = await request<any>(
    API_BASE + "/admin/generations/" + encodeURIComponent(jobId)
  );

  const source = raw?.data?.job
    ? { ...raw.data.job, ...raw.data }
    : raw?.data?.generation
      ? { ...raw.data.generation, ...raw.data }
      : raw?.data ?? raw;

  const generation = normalizeAdminGeneration(source);

  return {
    status: "ok" as const,
    data: {
      ...generation,
      inputSummary: source.inputSummary ?? source.input ?? null,
      outputs: Array.isArray(source.outputs)
        ? source.outputs.map((output: any) => ({
            id: String(output.id ?? ""),
            type: String(output.type ?? "—"),
            mimeType: output.mimeType == null ? null : String(output.mimeType),
            sizeBytes: output.sizeBytes == null ? null : Number(output.sizeBytes),
            metadata: output.metadata ?? null,
            createdAt: String(output.createdAt ?? new Date().toISOString()),
          }))
        : [],
      errorCode:
        source.errorCode ??
        source.error?.code ??
        null,
      errorMessage:
        source.errorMessage ??
        source.error?.message ??
        null,
    } as AdminGenerationDetail,
  };
}

export async function getHealth() {
  const response = await fetch("/health", { credentials: "include" });
  return response.ok;
}

export async function getDbHealth() {
  const response = await fetch("/health/db", { credentials: "include" });
  return response.ok;
}
