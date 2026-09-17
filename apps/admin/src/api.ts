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

export async function getHealth() {
  const response = await fetch("/health", { credentials: "include" });
  return response.ok;
}

export async function getDbHealth() {
  const response = await fetch("/health/db", { credentials: "include" });
  return response.ok;
}
