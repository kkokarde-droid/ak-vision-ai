import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Menu,
  Play,
  Plus,
  Sparkles,
  Square,
  UserPlus,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

import { motion } from "motion/react";

import {
  cancelGeneration,
  createGeneration,
  getCredits,
  getCurrentUser,
  getGeneration,
  getGenerationOutputs,
  login,
  logout,
  register,
  uploadImage,
  type AuthUser,
  type GenerationJob,
  type GenerationOutput,
} from "./api";

const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const promptIdeas = [
  "Luxury product launch with cinematic camera movement",
  "High-energy social reel for a modern IT brand",
  "Premium real-estate teaser with elegant transitions",
  "Bold festival campaign with dramatic lighting",
];

function getUserInitials(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const nameParts = (displayName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (nameParts.length >= 2) {
    return (
      nameParts[0][0] +
      nameParts[nameParts.length - 1][0]
    ).toUpperCase();
  }

  if (nameParts.length === 1) {
    return nameParts[0].slice(0, 2).toUpperCase();
  }

  return (email ?? "AK").trim().slice(0, 2).toUpperCase();
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(
  status: GenerationJob["status"],
): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Generating";
    case "completed":
      return "Ready";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusTone(
  status: GenerationJob["status"],
): "success" | "danger" | "muted" | "active" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "muted";
    default:
      return "active";
  }
}

function App() {
  const [authUser, setAuthUser] =
    useState<AuthUser | null>(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [authMode, setAuthMode] =
    useState<"login" | "register">("login");

  const [authEmail, setAuthEmail] =
    useState("");

  const [authPassword, setAuthPassword] =
    useState("");

  const [authDisplayName, setAuthDisplayName] =
    useState("");

  const [authSubmitting, setAuthSubmitting] =
    useState(false);

  const [authError, setAuthError] =
    useState<string | null>(null);

  const [prompt, setPrompt] =
    useState("");

  const [imageAssetId, setImageAssetId] =
    useState<string | null>(null);

  const [imagePreviewUrl, setImagePreviewUrl] =
    useState<string | null>(null);

  const [imageFileName, setImageFileName] =
    useState<string | null>(null);

  const [isUploadingImage, setIsUploadingImage] =
    useState(false);

  const [duration, setDuration] =
    useState<3 | 5>(5);

  const [priority, setPriority] =
    useState<"low" | "normal" | "high">("normal");

  const [providerModelId, setProviderModelId] =
    useState<
      "dop-lite" | "dop-turbo" | "dop-standard"
    >("dop-turbo");

  const [enhancePrompt, setEnhancePrompt] =
    useState(true);

  const [currentJob, setCurrentJob] =
    useState<GenerationJob | null>(null);

  const [outputs, setOutputs] =
    useState<GenerationOutput[]>([]);

  const [balance, setBalance] =
    useState<number | null>(null);

  const [reservedCredits, setReservedCredits] =
    useState<number | null>(null);

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [history, setHistory] =
    useState<GenerationJob[]>([]);

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const pollingRef =
    useRef<number | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      const response = await getCredits();

      setBalance(response.data.availableCredits);
      setReservedCredits(response.data.reservedCredits);
    } catch {
      // Keep workspace usable if credits refresh fails.
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search,
    );

    const oauthError = params.get("oauth_error");

    if (!oauthError) {
      return;
    }

    const messages: Record<string, string> = {
      google_account_exists:
        "This email already has an AK Vision AI account. Sign in with your password, then link Google from Account Settings.",

      google_account_unavailable:
        "This account is currently unavailable.",

      google_cancelled:
        "Google sign-in was cancelled.",

      google_failed:
        "Google sign-in could not be completed. Please try again.",
    };

    setAuthMode("login");

    setAuthError(
      messages[oauthError] ??
        "Social sign-in could not be completed. Please try again.",
    );

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname,
    );
  }, []);

  useEffect(() => {
    let mounted = true;

    void getCurrentUser()
      .then((user) => {
        if (!mounted) {
          return;
        }

        setAuthUser(user);

        if (user) {
          void refreshCredits();
        }
      })
      .catch(() => {
        if (mounted) {
          setAuthUser(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setAuthLoading(false);
        }
      });

    return () => {
      mounted = false;

      if (pollingRef.current !== null) {
        window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [refreshCredits]);

  const handleImageSelected = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }

      const allowedTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
      ]);

      if (!allowedTypes.has(file.type)) {
        setError(
          "Please upload a JPG, PNG, or WebP image.",
        );
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("Image must be smaller than 10 MB.");
        return;
      }

      setError(null);
      setIsUploadingImage(true);

      try {
        const response = await uploadImage(file);

        setImageAssetId(response.data.asset.id);
        setImagePreviewUrl(
          response.data.asset.previewUrl,
        );
        setImageFileName(file.name);
      } catch (uploadError) {
        setImageAssetId(null);
        setImagePreviewUrl(null);
        setImageFileName(null);

        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Image upload failed.",
        );
      } finally {
        setIsUploadingImage(false);
      }
    },
    [],
  );

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const response = await getGeneration(jobId);
        const job = response.data;

        setCurrentJob(job);

        setHistory((items) => {
          const filtered = items.filter(
            (item) => item.id !== job.id,
          );

          return [job, ...filtered].slice(0, 8);
        });

        if (job.status === "completed") {
          const outputResponse =
            await getGenerationOutputs(job.id);

          setOutputs(outputResponse.data);
          await refreshCredits();
        }

        if (terminalStatuses.has(job.status)) {
          return;
        }

        pollingRef.current = window.setTimeout(
          () => void pollJob(job.id),
          2000,
        );
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Could not refresh generation status.",
        );
      }
    },
    [refreshCredits],
  );

  const canGenerate =
    prompt.trim().length > 0 &&
    imageAssetId !== null &&
    !isSubmitting &&
    !isUploadingImage;

  const activeProgress =
    currentJob?.progress ?? 0;

  const activeStatus =
    currentJob?.status ?? null;

  const heroTitle =
    currentJob &&
    !terminalStatuses.has(currentJob.status)
      ? "Your idea is becoming a video."
      : "Turn one idea into a cinematic video.";

  async function handleAuthentication() {
    if (!authEmail.trim() || !authPassword) {
      setAuthError(
        "Enter your email and password.",
      );
      return;
    }

    if (
      authMode === "register" &&
      !authDisplayName.trim()
    ) {
      setAuthError("Enter your display name.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError(null);

    try {
      if (authMode === "login") {
        const response = await login(
          authEmail.trim(),
          authPassword,
        );

        setAuthUser(response.data.user);
      } else {
        const response = await register(
          authDisplayName.trim(),
          authEmail.trim(),
          authPassword,
        );

        setAuthUser(response.data.user);
      }

      setAuthPassword("");
      await refreshCredits();
    } catch (authRequestError) {
      setAuthError(
        authRequestError instanceof Error
          ? authRequestError.message
          : authMode === "login"
            ? "Login failed."
            : "Registration failed.",
      );
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      if (pollingRef.current !== null) {
        window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }

      setCurrentJob(null);
      setOutputs([]);
      setHistory([]);
      setBalance(null);
      setReservedCredits(null);
      setImageAssetId(null);
      setImagePreviewUrl(null);
      setImageFileName(null);
      setAuthUser(null);
    }
  }

  async function handleGenerate() {
    if (!imageAssetId) {
      setError(
        "Please upload an image before generating.",
      );
      return;
    }

    if (!canGenerate) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setOutputs([]);

    if (pollingRef.current !== null) {
      window.clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }

    const requestId = crypto.randomUUID();

    try {
      const response = await createGeneration({
        requestId,
        providerModelId,
        prompt: prompt.trim(),
        imageAssetId,
        durationSeconds: duration,
        priority,
        enhancePrompt,
      });

      setReservedCredits(
        response.data.pricing.creditsRequired,
      );

      const jobResponse = await getGeneration(
        response.data.job.id,
      );

      const job = jobResponse.data;

      setCurrentJob(job);

      setHistory((items) =>
        [job, ...items.filter(
          (item) => item.id !== job.id,
        )].slice(0, 8),
      );

      void pollJob(job.id);

      await refreshCredits();
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Generation could not be started.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (
      !currentJob ||
      terminalStatuses.has(currentJob.status)
    ) {
      return;
    }

    try {
      await cancelGeneration(currentJob.id);

      if (pollingRef.current !== null) {
        window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }

      const response = await getGeneration(
        currentJob.id,
      );

      setCurrentJob(response.data);

      await refreshCredits();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Generation could not be cancelled.",
      );
    }
  }

  function loadHistoryJob(job: GenerationJob) {
    setCurrentJob(job);
    setOutputs([]);
    setError(null);

    if (job.status === "completed") {
      void getGenerationOutputs(job.id)
        .then((response) => {
          setOutputs(response.data);
        })
        .catch(() => {
          // Main job status remains useful.
        });
    }
  }

  const generationCardTitle =
    activeStatus === "completed"
      ? "Generation ready"
      : activeStatus === "failed"
        ? "Generation needs attention"
        : activeStatus === "cancelled"
          ? "Generation cancelled"
          : "Generation in progress";

  const mainOutput = outputs[0] ?? null;

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0d0f14] text-white">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-black shadow-[0_20px_60px_rgba(255,255,255,0.08)]">
            <Sparkles size={24} />
          </div>

          <div className="mt-5 text-sm font-medium text-white/75">
            Opening your studio...
          </div>

          <div className="mt-2 text-xs text-white/30">
            Restoring your secure session
          </div>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <AuthScreen
        mode={authMode}
        email={authEmail}
        password={authPassword}
        displayName={authDisplayName}
        submitting={authSubmitting}
        error={authError}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
        }}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onDisplayNameChange={setAuthDisplayName}
        onSubmit={() => void handleAuthentication()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f14] text-white selection:bg-fuchsia-400/30">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute right-0 top-40 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen">
        <aside
          className={[
            "fixed inset-y-0 left-0 z-50 w-72 border-r border-white/[0.07] bg-[#11141b]/95 p-5 backdrop-blur-2xl transition-transform lg:static lg:translate-x-0",
            mobileOpen
              ? "translate-x-0"
              : "-translate-x-full",
          ].join(" ")}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-black">
                  <Sparkles size={18} />
                </div>

                <div>
                  <div className="text-sm font-semibold tracking-wide">
                    AK VISION AI
                  </div>

                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                    Creator Studio
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="rounded-lg p-2 text-white/50 hover:bg-white/5 lg:hidden"
                onClick={() => setMobileOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setCurrentJob(null);
                setOutputs([]);
                setPrompt("");
                setError(null);
                setImageAssetId(null);
                setImagePreviewUrl(null);
                setImageFileName(null);
              }}
              className="mt-8 flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black shadow-[0_14px_40px_rgba(255,255,255,0.1)]"
            >
              <Plus size={17} />
              New generation
            </button>

            <nav className="mt-5 space-y-1">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl bg-white/[0.08] px-3 py-3 text-sm text-white"
              >
                <Sparkles size={17} />
                Create
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/45 hover:bg-white/[0.04] hover:text-white"
              >
                <Film size={17} />
                My videos
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/45 hover:bg-white/[0.04] hover:text-white"
              >
                <Clapperboard size={17} />
                Projects
              </button>
            </nav>

            <div className="mt-8 text-[10px] font-medium uppercase tracking-[0.2em] text-white/25">
              Recent creations
            </div>

            <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
              {history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-xs leading-5 text-white/35">
                  Your recent generations will appear here.
                </div>
              ) : (
                history.map((job) => (
                  <button
                    type="button"
                    key={job.id}
                    onClick={() => loadHistoryJob(job)}
                    className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 text-left transition hover:bg-white/[0.06]"
                  >
                    <div className="line-clamp-2 text-xs text-white/75">
                      {job.prompt ??
                        "Untitled generation"}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-white/30">
                      <span>
                        {statusLabel(job.status)}
                      </span>

                      <span>
                        {formatDate(job.createdAt)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2.5 text-xs text-white/40 transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white/75"
            >
              <LogOut size={14} />
              Sign out
            </button>

            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/45">
                  Available credits
                </span>

                <Zap
                  size={15}
                  className="text-fuchsia-300"
                />
              </div>

              <div className="mt-2 text-2xl font-semibold">
                {balance === null
                  ? "—"
                  : formatCredits(balance)}
              </div>

              <div className="mt-1 text-[10px] text-white/30">
                Reserved:{" "}
                {reservedCredits === null
                  ? "—"
                  : formatCredits(reservedCredits)}
              </div>
            </div>
          </div>
        </aside>

        {mobileOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0d0f14]/75 backdrop-blur-xl">
            <div className="flex h-16 items-center justify-between px-5 lg:px-8">
              <button
                type="button"
                className="rounded-xl p-2 text-white/55 hover:bg-white/5 lg:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={20} />
              </button>

              <div className="hidden text-xs text-white/35 lg:block">
                Creator Studio / New generation
              </div>

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-xs sm:block">
                  <span className="text-white/35">
                    Credits
                  </span>{" "}
                  <span className="font-semibold">
                    {balance === null
                      ? "—"
                      : formatCredits(balance)}
                  </span>
                </div>

                <div
                  title={
                    authUser.displayName ??
                    authUser.email
                  }
                  aria-label={
                    authUser.displayName ??
                    authUser.email
                  }
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-semibold"
                >
                  {getUserInitials(
                    authUser.displayName,
                    authUser.email,
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] p-5 lg:p-8">
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <div className="mb-8 max-w-3xl">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/45">
                    <WandSparkles size={13} />
                    AI Video Studio
                  </div>

                  <h1 className="text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                    {heroTitle}
                  </h1>

                  <p className="mt-4 max-w-2xl text-sm leading-6 text-white/45 sm:text-base">
                    Describe the story. Add a reference
                    image. AK Vision AI handles the creative
                    direction, generation and rendering.
                  </p>
                </div>

                <div className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:p-6">
                  <div className="rounded-[24px] border border-white/[0.08] bg-black/20 p-4 sm:p-5">
                    <textarea
                      value={prompt}
                      onChange={(event) =>
                        setPrompt(event.target.value)
                      }
                      placeholder="Describe the video you want to create..."
                      maxLength={10000}
                      className="min-h-40 w-full resize-none bg-transparent text-base leading-7 text-white outline-none placeholder:text-white/20 sm:text-lg"
                    />

                    <div className="mt-4 flex flex-wrap gap-2">
                      {promptIdeas.map((idea) => (
                        <button
                          type="button"
                          key={idea}
                          onClick={() => setPrompt(idea)}
                          className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[11px] text-white/45 transition hover:border-white/15 hover:text-white/75"
                        >
                          {idea}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label
                          htmlFor="reference-image-upload"
                          className="flex items-center gap-2 text-sm font-medium text-white"
                        >
                          <ImageIcon size={15} />
                          Reference image
                        </label>

                        <span className="text-xs text-white/30">
                          JPG, PNG or WebP · max 10 MB
                        </span>
                      </div>

                      <input
                        id="reference-image-upload"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={isUploadingImage}
                        onChange={(event) => {
                          const file =
                            event.target.files?.[0];

                          void handleImageSelected(file);

                          event.currentTarget.value = "";
                        }}
                      />

                      <label
                        htmlFor="reference-image-upload"
                        className="block cursor-pointer rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.025] p-5 transition hover:border-white/20 hover:bg-white/[0.04]"
                      >
                        {imagePreviewUrl ? (
                          <div className="flex items-center gap-4">
                            <img
                              src={imagePreviewUrl}
                              alt="Reference preview"
                              className="h-20 w-20 rounded-xl object-cover"
                            />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-white">
                                {imageFileName ??
                                  "Reference image"}
                              </p>

                              <p className="mt-1 text-xs text-emerald-400">
                                {isUploadingImage
                                  ? "Uploading..."
                                  : "Image ready for generation"}
                              </p>
                            </div>

                            <span className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60">
                              Replace
                            </span>
                          </div>
                        ) : (
                          <div className="py-5 text-center">
                            <ImageIcon
                              size={26}
                              className="mx-auto text-white/30"
                            />

                            <p className="mt-3 text-sm font-medium text-white">
                              {isUploadingImage
                                ? "Uploading image..."
                                : "Choose a reference image"}
                            </p>

                            <p className="mt-1 text-xs text-white/30">
                              Upload the image you want to
                              animate
                            </p>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <SelectField
                      label="Duration"
                      value={String(duration)}
                      onChange={(value) => {
                        setDuration(
                          value === "3" ? 3 : 5,
                        );
                      }}
                      options={[
                        ["3", "3 seconds"],
                        ["5", "5 seconds"],
                      ]}
                    />

                    <SelectField
                      label="Model"
                      value={providerModelId}
                      onChange={(value) => {
                        if (
                          value === "dop-lite" ||
                          value === "dop-turbo" ||
                          value === "dop-standard"
                        ) {
                          setProviderModelId(value);
                        }
                      }}
                      options={[
                        ["dop-turbo", "DoP Turbo"],
                        ["dop-standard", "DoP Standard"],
                        ["dop-lite", "DoP Lite"],
                      ]}
                    />

                    <SelectField
                      label="Priority"
                      value={priority}
                      onChange={(value) => {
                        if (
                          value === "low" ||
                          value === "normal" ||
                          value === "high"
                        ) {
                          setPriority(value);
                        }
                      }}
                      options={[
                        ["normal", "Normal"],
                        ["high", "High"],
                        ["low", "Low"],
                      ]}
                    />
                  </div>

                  <label className="mt-3 flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                    <div>
                      <div className="text-sm font-medium text-white/80">
                        Enhance prompt
                      </div>

                      <div className="mt-1 text-xs text-white/30">
                        Let the generation pipeline improve
                        creative direction.
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      checked={enhancePrompt}
                      onChange={(event) =>
                        setEnhancePrompt(
                          event.target.checked,
                        )
                      }
                      className="h-4 w-4 accent-white"
                    />
                  </label>

                  {error && (
                    <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">
                      {error}
                    </div>
                  )}

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-5 text-white/30">
                      Pricing is calculated on the server
                      from authoritative provider pricing.
                    </div>

                    <button
                      type="button"
                      disabled={!canGenerate}
                      onClick={() => void handleGenerate()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {isSubmitting ? (
                        <>
                          <LoaderCircle
                            size={16}
                            className="animate-spin"
                          />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} />
                          Generate video
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[30px] border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">
                        {generationCardTitle}
                      </div>

                      <div className="mt-1 text-xs text-white/30">
                        Your latest generation
                      </div>
                    </div>

                    {currentJob && (
                      <StatusPill
                        status={currentJob.status}
                      />
                    )}
                  </div>

                  {!currentJob ? (
                    <div className="mt-5 grid min-h-[420px] place-items-center rounded-[24px] border border-dashed border-white/[0.08] bg-black/15 text-center">
                      <div>
                        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/[0.05]">
                          <Play
                            size={24}
                            className="text-white/35"
                          />
                        </div>

                        <div className="mt-4 text-sm text-white/55">
                          Your preview will appear here.
                        </div>

                        <div className="mt-1 text-xs text-white/25">
                          Start a generation to begin.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <motion.div
                      initial={{
                        opacity: 0,
                        y: 8,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                      }}
                      className="mt-5"
                    >
                      {mainOutput ? (
                        <div className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-black">
                          <div className="aspect-[9/14] overflow-hidden bg-gradient-to-br from-fuchsia-500/20 via-black to-cyan-500/10">
                            {mainOutput.mimeType.startsWith(
                              "video/",
                            ) ? (
                              <video
                                src={mainOutput.url}
                                className="h-full w-full object-cover"
                                controls
                                playsInline
                              />
                            ) : (
                              <img
                                src={mainOutput.url}
                                alt="Generated output"
                                className="h-full w-full object-cover"
                              />
                            )}
                          </div>

                          <div className="flex items-center justify-between p-3">
                            <div className="text-xs text-white/40">
                              {mainOutput.mimeType}
                            </div>

                            <a
                              href={mainOutput.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black"
                            >
                              <Download size={14} />
                              Open
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[24px] border border-white/[0.08] bg-black/20 p-5">
                          <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-fuchsia-400/10 via-black to-cyan-300/10">
                            <div className="aspect-[9/14]" />

                            {!terminalStatuses.has(
                              currentJob.status,
                            ) && (
                              <div className="absolute inset-x-8 bottom-8">
                                <div className="mb-3 flex items-center justify-between text-xs">
                                  <span className="text-white/45">
                                    {statusLabel(
                                      currentJob.status,
                                    )}
                                  </span>

                                  <span className="font-medium">
                                    {activeProgress}%
                                  </span>
                                </div>

                                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <motion.div
                                    animate={{
                                      width: `${Math.max(
                                        4,
                                        activeProgress,
                                      )}%`,
                                    }}
                                    className="h-full rounded-full bg-white"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="mt-5">
                            <StatusTimeline
                              status={currentJob.status}
                            />
                          </div>

                          {currentJob.status !==
                            "completed" &&
                            currentJob.status !==
                              "failed" &&
                            currentJob.status !==
                              "cancelled" && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCancel()
                                }
                                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/65 hover:bg-white/5"
                              >
                                <Square size={13} />
                                Cancel generation
                              </button>
                            )}

                          {currentJob.error && (
                            <div className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-200">
                              {currentJob.error.message}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>

                {currentJob && (
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-xs text-white/35">
                    <div className="flex items-center justify-between">
                      <span>Job</span>

                      <span className="font-mono">
                        {currentJob.id.slice(0, 8)}...
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span>Created</span>

                      <span>
                        {formatDate(
                          currentJob.createdAt,
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function AuthScreen({
  mode,
  email,
  password,
  displayName,
  submitting,
  error,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onDisplayNameChange,
  onSubmit,
}: {
  mode: "login" | "register";
  email: string;
  password: string;
  displayName: string;
  submitting: boolean;
  error: string | null;
  onModeChange: (
    mode: "login" | "register",
  ) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const [socialNotice, setSocialNotice] =
    useState<string | null>(null);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d0f14] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-[500px] w-[500px] rounded-full bg-fuchsia-500/12 blur-[120px]" />
        <div className="absolute -bottom-48 -right-32 h-[550px] w-[550px] rounded-full bg-cyan-400/10 blur-[120px]" />
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-500/7 blur-[110px]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/45">
            <Sparkles size={13} />
            AI Creative Studio
          </div>

          <h1 className="mt-7 max-w-3xl text-6xl font-semibold leading-[0.98] tracking-[-0.055em] xl:text-7xl">
            Your next idea
            <span className="block text-white/35">
              starts here.
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-base leading-7 text-white/40">
            Create cinematic AI videos from a single
            idea. Bring your visual reference, choose
            your direction, and let AK Vision AI handle
            the creative heavy lifting.
          </p>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {[
              ["01", "Describe"],
              ["02", "Generate"],
              ["03", "Publish"],
            ].map(([number, label]) => (
              <div
                key={number}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"
              >
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/25">
                  {number}
                </div>

                <div className="mt-2 text-sm font-medium text-white/70">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="mb-7 text-center lg:hidden">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-black">
              <Sparkles size={20} />
            </div>

            <div className="mt-4 text-sm font-semibold tracking-[0.14em]">
              AK VISION AI
            </div>
          </div>

          <div className="rounded-[32px] border border-white/[0.08] bg-white/[0.045] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8">
            <div className="mt-2">
              <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                {mode === "login"
                  ? "Welcome back."
                  : "Build something remarkable."}
              </h2>

              <p className="mt-2 text-sm leading-6 text-white/35">
                {mode === "login"
                  ? "Sign in and continue creating."
                  : "Your creative workspace is ready when you are."}
              </p>
            </div>

            {mode === "login" && (
              <>
                <div className="mt-7">
                  <button
                    type="button"
                    aria-label="Continue with Google"
                    onClick={() => {
                      setSocialNotice(null);

                      window.location.assign(
                        "/api/v1/auth/google/start",
                      );
                    }}
                    className="group flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 text-sm font-medium text-white transition hover:border-white/[0.16] hover:bg-white/[0.06] active:scale-[0.99]"
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-6 w-6 place-items-center rounded-full bg-white text-[13px] font-bold text-black"
                    >
                      G
                    </span>

                    <span>
                      Continue with Google
                    </span>
                  </button>
                </div>

                <div className="mt-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/20">
                  <div className="h-px flex-1 bg-white/[0.08]" />
                  <span>OR</span>
                  <div className="h-px flex-1 bg-white/[0.08]" />
                </div>
              </>
            )}

            <div className="mt-7 space-y-4">
              {mode === "register" && (
                <label className="block">
                  <span className="mb-2 block text-xs text-white/40">
                    Display name
                  </span>

                  <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4">
                    <UserPlus
                      size={16}
                      className="text-white/25"
                    />

                    <input
                      value={displayName}
                      onChange={(event) =>
                        onDisplayNameChange(
                          event.target.value,
                        )
                      }
                      autoComplete="name"
                      className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-white/20"
                      placeholder="Your name"
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="mb-2 block text-xs text-white/40">
                  Email
                </span>

                <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4">
                  <Mail
                    size={16}
                    className="text-white/25"
                  />

                  <input
                    value={email}
                    onChange={(event) =>
                      onEmailChange(
                        event.target.value,
                      )
                    }
                    type="email"
                    autoComplete="email"
                    className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-white/20"
                    placeholder="you@example.com"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs text-white/40">
                  Password
                </span>

                <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4">
                  <LockKeyhole
                    size={16}
                    className="text-white/25"
                  />

                  <input
                    value={password}
                    onChange={(event) =>
                      onPasswordChange(
                        event.target.value,
                      )
                    }
                    type="password"
                    autoComplete={
                      mode === "login"
                        ? "current-password"
                        : "new-password"
                    }
                    className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-white/20"
                    placeholder="••••••••"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        onSubmit();
                      }
                    }}
                  />
                </div>
              </label>
            </div>

            {(error || socialNotice) && (
              <div
                className={[
                  "mt-4 rounded-2xl border px-4 py-3 text-sm leading-5",
                  socialNotice && !error
                    ? "border-white/[0.08] bg-white/[0.035] text-white/55"
                    : "border-red-400/20 bg-red-400/5 text-red-200",
                ].join(" ")}
              >
                {error || socialNotice}
              </div>
            )}

            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <LoaderCircle
                    size={16}
                    className="animate-spin"
                  />

                  {mode === "login"
                    ? "Signing in..."
                    : "Creating account..."}
                </>
              ) : (
                <>
                  {mode === "login" ? (
                    <LogIn size={16} />
                  ) : (
                    <UserPlus size={16} />
                  )}

                  {mode === "login"
                    ? "Enter studio"
                    : "Create my studio"}
                </>
              )}
            </button>

            <div className="mt-5 text-center text-xs text-white/35">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() =>
                      onModeChange("register")
                    }
                    className="font-medium text-white/70 transition hover:text-white"
                  >
                    Create account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() =>
                      onModeChange("login")
                    }
                    className="font-medium text-white/70 transition hover:text-white"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>

            <div className="mt-5 text-center text-[11px] leading-5 text-white/25">
              Secure session cookies keep your
              authenticated API requests protected.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="relative block rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="text-xs text-white/40">
        {label}
      </div>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-2 w-full appearance-none bg-transparent pr-6 text-sm outline-none"
      >
        {options.map(
          ([optionValue, optionLabel]) => (
            <option
              key={optionValue}
              value={optionValue}
              className="bg-[#11131a]"
            >
              {optionLabel}
            </option>
          ),
        )}
      </select>

      <ChevronDown
        size={14}
        className="pointer-events-none absolute bottom-5 right-4 text-white/35"
      />
    </label>
  );
}

function StatusPill({
  status,
}: {
  status: GenerationJob["status"];
}) {
  const tone = statusTone(status);

  return (
    <div
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em]",
        tone === "success"
          ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200"
          : tone === "danger"
            ? "border-red-400/20 bg-red-400/5 text-red-200"
            : tone === "muted"
              ? "border-white/10 bg-white/[0.03] text-white/35"
              : "border-cyan-300/15 bg-cyan-300/5 text-cyan-100",
      ].join(" ")}
    >
      {tone === "active" ? (
        <LoaderCircle
          size={11}
          className="animate-spin"
        />
      ) : tone === "success" ? (
        <Check size={11} />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}

      {statusLabel(status)}
    </div>
  );
}

function StatusTimeline({
  status,
}: {
  status: GenerationJob["status"];
}) {
  const stages = [
    ["queued", "Queued"],
    ["processing", "Generating"],
    ["completed", "Ready"],
  ] as const;

  const currentIndex =
    status === "queued"
      ? 0
      : status === "processing"
        ? 1
        : status === "completed"
          ? 2
          : -1;

  return (
    <div className="space-y-3">
      {stages.map(([stage, label], index) => {
        const done = currentIndex >= index;

        return (
          <div
            key={stage}
            className="flex items-center gap-3"
          >
            <div
              className={[
                "grid h-7 w-7 place-items-center rounded-full border",
                done
                  ? "border-white/20 bg-white text-black"
                  : "border-white/10 bg-white/[0.025] text-white/20",
              ].join(" ")}
            >
              {done ? (
                <Check size={13} />
              ) : (
                index + 1
              )}
            </div>

            <div
              className={[
                "text-xs",
                done
                  ? "text-white/75"
                  : "text-white/25",
              ].join(" ")}
            >
              {label}
            </div>

            {index < stages.length - 1 && (
              <div className="ml-auto h-px flex-1 bg-white/[0.06]" />
            )}
          </div>
        );
      })}

      {(status === "failed" ||
        status === "cancelled") && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-xs text-white/40">
          {status === "failed"
            ? "The generation stopped with an error."
            : "The generation was cancelled."}
        </div>
      )}
    </div>
  );
}

export default App;