export type GenerationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationMode =
  | "text_to_video"
  | "image_to_video"
  | "video_to_video"
  | "ai_director";

export type GenerationJob = {
  id: string;
  requestId: string;
  projectId: string | null;
  conversationId: string | null;
  type: string;
  status: GenerationStatus;
  priority: "low" | "normal" | "high";
  prompt: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  error: { message: string } | null;
};

export type GenerationOutput = {
  id: string;
  type: string;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
};

export type CreateGenerationResponse = {
  status: "ok";
  data: {
    job: { id: string };
    replayed: boolean;
    pricing: {
      pricingVersion: string;
      currency: string;
      creditsRequired: number;
      customerChargeMinor: number;
    };
  };
};

export type GenerationResponse = {
  status: "ok";
  data: GenerationJob;
};

export type GenerationOutputsResponse = {
  status: "ok";
  data: GenerationOutput[];
};

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

type ErrorResponse = {
  status: "error";
  code?: string;
  message?: string;
};

const API_BASE = "/api/v1";

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Network error: ${error.message}`
        : "Network error while contacting the API",
    );
  }

  const rawBody = await response.text();
  let payload: T | ErrorResponse | null = null;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as T | ErrorResponse;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getCurrentUser() {
  const response = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (response.status === 401) return null;
  const payload = (await response.json()) as { status: "ok"; data: AuthUser };
  if (!response.ok) throw new Error("Could not restore your session.");
  return payload.data;
}

export async function login(email: string, password: string) {
  return request<{ status: "ok"; data: { user: AuthUser } }>(
    `${API_BASE}/auth/login`,
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
}

export async function register(displayName: string, email: string, password: string) {
  return request<{ status: "ok"; data: { user: AuthUser } }>(
    `${API_BASE}/auth/register`,
    {
      method: "POST",
      body: JSON.stringify({ displayName, email, password, accountType: "individual" }),
    },
  );
}

export async function logout() {
  return request<{ status: "ok"; message: string }>(`${API_BASE}/auth/logout`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type UploadImageResponse = {
  status: "ok";
  data: {
    asset: {
      id: string;
      name: string;
      type: "image";
      mimeType: string;
      sizeBytes: number;
      previewUrl: string;
    };
  };
};

export async function uploadImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/media/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Network error: ${error.message}`
        : "Network error while uploading image.",
    );
  }

  const rawBody = await response.text();
  let payload: UploadImageResponse | ErrorResponse | null = null;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as UploadImageResponse | ErrorResponse;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `Image upload failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as UploadImageResponse;
}

export async function createGeneration(input: {
  requestId: string;
  mode?: GenerationMode;

  prompt: string;
  imageAssetId?: string;
  durationSeconds: number;
  priority?: "low" | "normal" | "high";
  enhancePrompt?: boolean;
  seed?: number;
  organizationId?: string;
}) {
  const mode = input.mode ??
    (input.imageAssetId ? "image_to_video" : "text_to_video");

  return request<CreateGenerationResponse>(`${API_BASE}/generation`, {
    method: "POST",
    body: JSON.stringify({ ...input, mode }),
  });
}

export async function getGeneration(jobId: string, organizationId?: string) {
  const query = organizationId
    ? `?organizationId=${encodeURIComponent(organizationId)}`
    : "";
  return request<GenerationResponse>(`${API_BASE}/generation/${jobId}${query}`);
}

export async function getGenerationOutputs(jobId: string, organizationId?: string) {
  const query = organizationId
    ? `?organizationId=${encodeURIComponent(organizationId)}`
    : "";
  return request<GenerationOutputsResponse>(
    `${API_BASE}/generation/${jobId}/output${query}`,
  );
}

export async function cancelGeneration(jobId: string) {
  return request<{ status: "ok"; data: unknown }>(
    `${API_BASE}/generation/${jobId}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function getCredits() {
  return request<{
    status: "ok";
    data: { availableCredits: number; reservedCredits: number; currency: string };
  }>(`${API_BASE}/credits`);
}
