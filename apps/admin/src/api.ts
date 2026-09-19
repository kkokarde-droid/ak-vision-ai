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




export type AdminCreditBalance = {
  id: string;
  customer: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    accountType: string;
  };
  balance: {
    id: string;
    availableCredits: number;
    reservedCredits: number;
    currency: string;
    updatedAt: string;
  } | null;
  totalCredits: number;
};

export type AdminCreditTransaction = {
  id: string;
  type: string;
  source: string;
  amount: number;
  availableBalanceAfter: number;
  reservedBalanceAfter: number;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
};

export type AdminCreditReservation = {
  id: string;
  amount: number;
  status: string;
  referenceId: string | null;
  expiresAt: string | null;
  releasedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
};

export type AdminCreditUsage = {
  id: string;
  requestId: string;
  providerId: string | null;
  providerModelId: string | null;
  creditsUsed: number;
  providerCostMinor: number | null;
  infrastructureCostMinor: number | null;
  retryCostMinor: number | null;
  customerChargeMinor: number | null;
  platformContributionMinor: number | null;
  currency: string;
  createdAt: string;
};

export type AdminCreditDetail = AdminCreditBalance & {
  transactions: AdminCreditTransaction[];
  reservations: AdminCreditReservation[];
  usage: AdminCreditUsage[];
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



export async function getAdminCredits(input: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page ?? 1));
  params.set("pageSize", String(input.pageSize ?? 20));
  if (input.search?.trim()) params.set("search", input.search.trim());

  const raw = await request<any>(
    API_BASE + "/admin/credits?" + params.toString()
  );

  const rows = Array.isArray(raw?.data) ? raw.data : [];
  const meta = raw?.meta ?? {};

  return {
    status: "ok" as const,
    data: rows.map((row: any) => ({
      id: String(row.id ?? ""),
      customer: {
        id: String(row.customer?.id ?? ""),
        email: String(row.customer?.email ?? "—"),
        displayName: String(row.customer?.displayName ?? "—"),
        status: String(row.customer?.status ?? "—"),
        accountType: String(row.customer?.accountType ?? "—"),
      },
      balance: row.balance
        ? {
            id: String(row.balance.id ?? ""),
            availableCredits: Number(row.balance.availableCredits ?? 0),
            reservedCredits: Number(row.balance.reservedCredits ?? 0),
            currency: String(row.balance.currency ?? "INR"),
            updatedAt: String(row.balance.updatedAt ?? new Date().toISOString()),
          }
        : null,
      totalCredits: Number(row.totalCredits ?? 0),
    } satisfies AdminCreditBalance)),
    meta: {
      page: Number(meta.page ?? input.page ?? 1),
      pageSize: Number(meta.pageSize ?? input.pageSize ?? 20),
      total: Number(meta.total ?? rows.length),
      totalPages: Number(meta.totalPages ?? 1),
    },
  };
}

export async function getAdminCreditDetail(userId: string) {
  const raw = await request<any>(
    API_BASE + "/admin/credits/" + encodeURIComponent(userId)
  );
  const source = raw?.data ?? raw;
  return {
    status: "ok" as const,
    data: {
      id: String(source.id ?? ""),
      customer: {
        id: String(source.customer?.id ?? ""),
        email: String(source.customer?.email ?? "—"),
        displayName: String(source.customer?.displayName ?? "—"),
        status: String(source.customer?.status ?? "—"),
        accountType: String(source.customer?.accountType ?? "—"),
      },
      balance: source.balance
        ? {
            id: String(source.balance.id ?? ""),
            availableCredits: Number(source.balance.availableCredits ?? 0),
            reservedCredits: Number(source.balance.reservedCredits ?? 0),
            currency: String(source.balance.currency ?? "INR"),
            updatedAt: String(source.balance.updatedAt ?? new Date().toISOString()),
          }
        : null,
      totalCredits: Number(source.totalCredits ?? 0),
      transactions: Array.isArray(source.transactions)
        ? source.transactions.map((row: any) => ({
            id: String(row.id ?? ""),
            type: String(row.type ?? "—"),
            source: String(row.source ?? "—"),
            amount: Number(row.amount ?? 0),
            availableBalanceAfter: Number(row.availableBalanceAfter ?? 0),
            reservedBalanceAfter: Number(row.reservedBalanceAfter ?? 0),
            referenceId: row.referenceId == null ? null : String(row.referenceId),
            description: row.description == null ? null : String(row.description),
            createdAt: String(row.createdAt ?? new Date().toISOString()),
          }))
        : [],
      reservations: Array.isArray(source.reservations)
        ? source.reservations.map((row: any) => ({
            id: String(row.id ?? ""),
            amount: Number(row.amount ?? 0),
            status: String(row.status ?? "—"),
            referenceId: row.referenceId == null ? null : String(row.referenceId),
            expiresAt: row.expiresAt == null ? null : String(row.expiresAt),
            releasedAt: row.releasedAt == null ? null : String(row.releasedAt),
            consumedAt: row.consumedAt == null ? null : String(row.consumedAt),
            createdAt: String(row.createdAt ?? new Date().toISOString()),
          }))
        : [],
      usage: Array.isArray(source.usage)
        ? source.usage.map((row: any) => ({
            id: String(row.id ?? ""),
            requestId: String(row.requestId ?? ""),
            providerId: row.providerId == null ? null : String(row.providerId),
            providerModelId: row.providerModelId == null ? null : String(row.providerModelId),
            creditsUsed: Number(row.creditsUsed ?? 0),
            providerCostMinor: row.providerCostMinor == null ? null : Number(row.providerCostMinor),
            infrastructureCostMinor: row.infrastructureCostMinor == null ? null : Number(row.infrastructureCostMinor),
            retryCostMinor: row.retryCostMinor == null ? null : Number(row.retryCostMinor),
            customerChargeMinor: row.customerChargeMinor == null ? null : Number(row.customerChargeMinor),
            platformContributionMinor: row.platformContributionMinor == null ? null : Number(row.platformContributionMinor),
            currency: String(row.currency ?? "INR"),
            createdAt: String(row.createdAt ?? new Date().toISOString()),
          }))
        : [],
    } as AdminCreditDetail,
  };
}

export async function grantAdminCredits(userId: string, input: {
  amount: number;
  description?: string;
  referenceId?: string;
  idempotencyKey: string;
}) {
  return request<{
    status: "ok";
    data: {
      transaction: AdminCreditTransaction;
      balance: {
        availableCredits: number;
        reservedCredits: number;
        currency: string;
      };
    };
  }>(API_BASE + "/admin/credits/" + encodeURIComponent(userId) + "/grant", {
    method: "POST",
    body: JSON.stringify(input),
  });
}


export async function getHealth() {
  const response = await fetch("/health", { credentials: "include" });
  return response.ok;
}

export async function getDbHealth() {
  const response = await fetch("/health/db", { credentials: "include" });
  return response.ok;
}
