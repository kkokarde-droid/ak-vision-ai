import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
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
  type GenerationMode,
  type GenerationOutput,
} from "./api";

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

const modes: Array<{
  id: GenerationMode;
  title: string;
  description: string;
  icon: typeof Sparkles;
  enabled: boolean;
}> = [
  {
    id: "text_to_video",
    title: "Text to Video",
    description: "Start with a scene, story or campaign idea.",
    icon: Sparkles,
    enabled: true,
  },
  {
    id: "image_to_video",
    title: "Image to Video",
    description: "Upload a visual and bring it to life.",
    icon: ImageIcon,
    enabled: true,
  },
  {
    id: "ai_director",
    title: "AI Director",
    description: "Turn a rough brief into a directed sequence.",
    icon: WandSparkles,
    enabled: false,
  },
];

const promptIdeas = [
  "Luxury product launch with cinematic camera movement",
  "एक प्रीमियम टेक ब्रांड के लिए सिनेमैटिक वीडियो बनाओ",
  "महाराष्ट्रातील सणासाठी ऊर्जावान सोशल मीडिया रील",
  "一段高级房地产宣传片，镜头缓慢推进",
];

function getUserInitials(displayName: string | null | undefined, email: string | null | undefined) {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts.at(-1)![0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email ?? "AK").slice(0, 2).toUpperCase();
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: GenerationJob["status"]) {
  switch (status) {
    case "queued": return "Queued";
    case "processing": return "Generating";
    case "completed": return "Ready";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

function statusTone(status: GenerationJob["status"]) {
  switch (status) {
    case "completed": return "success" as const;
    case "failed": return "danger" as const;
    case "cancelled": return "muted" as const;
    default: return "active" as const;
  }
}

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [mode, setMode] = useState<GenerationMode>("text_to_video");
  const [prompt, setPrompt] = useState("");
  const [imageAssetId, setImageAssetId] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [duration, setDuration] = useState<3 | 5>(5);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [currentJob, setCurrentJob] = useState<GenerationJob | null>(null);
  const [outputs, setOutputs] = useState<GenerationOutput[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [reservedCredits, setReservedCredits] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GenerationJob[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pollingRef = useRef<number | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      const response = await getCredits();
      setBalance(response.data.availableCredits);
      setReservedCredits(response.data.reservedCredits);
    } catch {
      // Keep the studio usable when a background credit refresh fails.
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("oauth_error");
    if (!oauthError) return;
    const messages: Record<string, string> = {
      google_account_exists: "This email already has an AK Vision AI account. Sign in with your password, then link Google from Account Settings.",
      google_account_unavailable: "This account is currently unavailable.",
      google_cancelled: "Google sign-in was cancelled.",
      google_failed: "Google sign-in could not be completed. Please try again.",
    };
    setAuthMode("login");
    setAuthError(messages[oauthError] ?? "Social sign-in could not be completed. Please try again.");
    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  useEffect(() => {
    let mounted = true;
    void getCurrentUser()
      .then((user) => {
        if (!mounted) return;
        setAuthUser(user);
        if (user) void refreshCredits();
      })
      .catch(() => {
        if (mounted) setAuthUser(null);
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    return () => {
      mounted = false;
      if (pollingRef.current !== null) window.clearTimeout(pollingRef.current);
    };
  }, [refreshCredits]);

  const handleImageSelected = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setError("Please upload a JPG, PNG, or WebP image.");
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
      setImagePreviewUrl(response.data.asset.previewUrl);
      setImageFileName(file.name);
    } catch (uploadError) {
      setImageAssetId(null);
      setImagePreviewUrl(null);
      setImageFileName(null);
      setError(uploadError instanceof Error ? uploadError.message : "Image upload failed.");
    } finally {
      setIsUploadingImage(false);
    }
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const response = await getGeneration(jobId);
      const job = response.data;
      setCurrentJob(job);
      setHistory((items) => [job, ...items.filter((item) => item.id !== job.id)].slice(0, 8));
      if (job.status === "completed") {
        const outputResponse = await getGenerationOutputs(job.id);
        setOutputs(outputResponse.data);
        await refreshCredits();
      }
      if (terminalStatuses.has(job.status)) return;
      pollingRef.current = window.setTimeout(() => void pollJob(job.id), 2000);
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Could not refresh generation status.");
    }
  }, [refreshCredits]);

  const canGenerate =
    mode !== "ai_director" &&
    prompt.trim().length > 0 &&
    (mode !== "image_to_video" || imageAssetId !== null) &&
    !isSubmitting &&
    !isUploadingImage;

  async function handleAuthentication() {
    if (!authEmail.trim() || !authPassword) {
      setAuthError("Enter your email and password.");
      return;
    }
    if (authMode === "register" && !authDisplayName.trim()) {
      setAuthError("Enter your display name.");
      return;
    }
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const response = authMode === "login"
        ? await login(authEmail.trim(), authPassword)
        : await register(authDisplayName.trim(), authEmail.trim(), authPassword);
      setAuthUser(response.data.user);
      setAuthPassword("");
      await refreshCredits();
    } catch (requestError) {
      setAuthError(requestError instanceof Error ? requestError.message : "Authentication failed.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      if (pollingRef.current !== null) window.clearTimeout(pollingRef.current);
      setCurrentJob(null);
      setOutputs([]);
      setHistory([]);
      setBalance(null);
      setReservedCredits(null);
      resetComposer();
      setAuthUser(null);
    }
  }

  function resetComposer() {
    setMode("text_to_video");
    setPrompt("");
    setImageAssetId(null);
    setImagePreviewUrl(null);
    setImageFileName(null);
    setError(null);
  }

  function selectMode(nextMode: GenerationMode) {
    const selected = modes.find((item) => item.id === nextMode);
    if (!selected?.enabled) return;
    setMode(nextMode);
    setError(null);
    if (nextMode !== "image_to_video") {
      setImageAssetId(null);
      setImagePreviewUrl(null);
      setImageFileName(null);
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    setIsSubmitting(true);
    setError(null);
    setOutputs([]);
    if (pollingRef.current !== null) window.clearTimeout(pollingRef.current);
    try {
      const response = await createGeneration({
        requestId: crypto.randomUUID(),
        mode,
        ...(mode === "image_to_video" ? { providerModelId: "dop-turbo", imageAssetId: imageAssetId! } : {}),
        prompt: prompt.trim(),
        durationSeconds: duration,
        enhancePrompt,
      });
      setReservedCredits(response.data.pricing.creditsRequired);
      const jobResponse = await getGeneration(response.data.job.id);
      setCurrentJob(jobResponse.data);
      setHistory((items) => [jobResponse.data, ...items.filter((item) => item.id !== jobResponse.data.id)].slice(0, 8));
      void pollJob(jobResponse.data.id);
      await refreshCredits();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Generation could not be started.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!currentJob || terminalStatuses.has(currentJob.status)) return;
    try {
      await cancelGeneration(currentJob.id);
      if (pollingRef.current !== null) window.clearTimeout(pollingRef.current);
      const response = await getGeneration(currentJob.id);
      setCurrentJob(response.data);
      await refreshCredits();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Generation could not be cancelled.");
    }
  }

  function loadHistoryJob(job: GenerationJob) {
    setCurrentJob(job);
    setOutputs([]);
    setError(null);
    if (job.status === "completed") {
      void getGenerationOutputs(job.id).then((response) => setOutputs(response.data)).catch(() => undefined);
    }
  }

  const mainOutput = outputs[0] ?? null;
  const activeStatus = currentJob?.status ?? null;
  const generationCardTitle = activeStatus === "completed"
    ? "Generation ready"
    : activeStatus === "failed"
      ? "Generation needs attention"
      : activeStatus === "cancelled"
        ? "Generation cancelled"
        : "Your latest generation";

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0d0f14] text-white">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-black"><Sparkles size={24} /></div>
          <div className="mt-5 text-sm font-medium text-white/75">Opening your studio...</div>
          <div className="mt-2 text-xs text-white/30">Restoring your secure session</div>
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
        onModeChange={(nextMode) => { setAuthMode(nextMode); setAuthError(null); }}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onDisplayNameChange={setAuthDisplayName}
        onSubmit={() => void handleAuthentication()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0d12] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-48 -top-48 h-[520px] w-[520px] rounded-full bg-fuchsia-500/10 blur-[120px]" />
        <div className="absolute right-0 top-48 h-[420px] w-[420px] rounded-full bg-cyan-400/8 blur-[120px]" />
      </div>

      <div className="relative flex min-h-screen">
        <aside className={["fixed inset-y-0 left-0 z-50 w-72 border-r border-white/[0.07] bg-[#10131a]/96 p-5 backdrop-blur-2xl transition-transform lg:static lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full"].join(" ")}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-black"><Sparkles size={18} /></div>
                <div>
                  <div className="text-sm font-semibold tracking-wide">AK VISION AI</div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">Creator Studio</div>
                </div>
              </div>
              <button type="button" className="rounded-lg p-2 text-white/45 lg:hidden" onClick={() => setMobileOpen(false)}><X size={18} /></button>
            </div>

            <button type="button" onClick={resetComposer} className="mt-8 flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"><Plus size={17} /> New creation</button>

            <nav className="mt-5 space-y-1">
              <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-white/[0.08] px-3 py-3 text-sm"><Sparkles size={17} /> Create</button>
              <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/45 hover:bg-white/[0.04] hover:text-white"><Film size={17} /> My videos</button>
              <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/45 hover:bg-white/[0.04] hover:text-white"><Clapperboard size={17} /> Projects</button>
            </nav>

            <div className="mt-8 text-[10px] uppercase tracking-[0.2em] text-white/25">Recent creations</div>
            <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
              {history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-xs leading-5 text-white/35">Your recent generations will appear here.</div>
              ) : history.map((job) => (
                <button key={job.id} type="button" onClick={() => loadHistoryJob(job)} className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 text-left hover:bg-white/[0.06]">
                  <div className="line-clamp-2 text-xs text-white/75">{job.prompt ?? "Untitled generation"}</div>
                  <div className="mt-2 flex justify-between text-[10px] text-white/30"><span>{statusLabel(job.status)}</span><span>{formatDate(job.createdAt)}</span></div>
                </button>
              ))}
            </div>

            <button type="button" onClick={() => void handleLogout()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2.5 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white/75"><LogOut size={14} /> Sign out</button>

            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
              <div className="flex items-center justify-between text-xs text-white/45"><span>Available credits</span><Zap size={15} /></div>
              <div className="mt-2 text-2xl font-semibold">{balance === null ? "—" : formatCredits(balance)}</div>
              <div className="mt-1 text-[10px] text-white/30">Reserved: {reservedCredits === null ? "—" : formatCredits(reservedCredits)}</div>
            </div>
          </div>
        </aside>

        {mobileOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />}

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0b0d12]/80 backdrop-blur-xl">
            <div className="flex h-16 items-center justify-between px-5 lg:px-8">
              <button type="button" className="rounded-xl p-2 text-white/55 lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
              <div className="hidden text-xs text-white/35 lg:block">Creator Studio / Create</div>
              <div className="ml-auto flex items-center gap-3">
                <div className="hidden rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-xs sm:block"><span className="text-white/35">Credits</span> <span className="font-semibold">{balance === null ? "—" : formatCredits(balance)}</span></div>
                <div className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-semibold" title={authUser.email}>{getUserInitials(authUser.displayName, authUser.email)}</div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] p-5 lg:p-8">
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <div className="mb-7 max-w-3xl">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/45"><WandSparkles size={13} /> AI Creative Studio</div>
                  <h1 className="text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl lg:text-6xl">Create without thinking about the plumbing.</h1>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-white/45 sm:text-base">Describe what you want in the language you naturally use. AK Vision AI handles routing, generation and rendering behind the scenes.</p>
                </div>

                <div className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.3)] sm:p-6">
                  <div className="grid gap-3 md:grid-cols-3">
                    {modes.map((item) => {
                      const Icon = item.icon;
                      const active = mode === item.id;
                      return (
                        <button key={item.id} type="button" disabled={!item.enabled} onClick={() => selectMode(item.id)} className={["relative rounded-2xl border p-4 text-left transition", active ? "border-white/20 bg-white/[0.10] shadow-[0_12px_40px_rgba(0,0,0,0.18)]" : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.13] hover:bg-white/[0.05]", !item.enabled ? "cursor-not-allowed opacity-45" : ""].join(" ")}>
                          {!item.enabled && <span className="absolute right-3 top-3 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-white/35">Coming soon</span>}
                          <Icon size={18} className="text-white/65" />
                          <div className="mt-4 text-sm font-semibold">{item.title}</div>
                          <div className="mt-1 text-xs leading-5 text-white/35">{item.description}</div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-5 rounded-[24px] border border-white/[0.08] bg-black/20 p-4 sm:p-5">
                    <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={10000} className="min-h-44 w-full resize-none bg-transparent text-base leading-7 text-white outline-none placeholder:text-white/20 sm:text-lg" placeholder={mode === "image_to_video" ? "Describe how you want your image to move, feel and transform..." : "Describe the video you want to create... English, हिंदी, मराठी, 中文 and more are welcome."} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      {promptIdeas.map((idea) => <button key={idea} type="button" onClick={() => setPrompt(idea)} className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[11px] text-white/45 hover:border-white/15 hover:text-white/75">{idea}</button>)}
                    </div>
                  </div>

                  {mode === "image_to_video" && (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium"><ImageIcon size={15} /> Reference image</div>
                        <span className="text-xs text-white/30">JPG, PNG or WebP · max 10 MB</span>
                      </div>
                      <input id="reference-image-upload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isUploadingImage} onChange={(event) => { void handleImageSelected(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                      <label htmlFor="reference-image-upload" className="block cursor-pointer rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.025] p-5 hover:border-white/20 hover:bg-white/[0.04]">
                        {imagePreviewUrl ? (
                          <div className="flex items-center gap-4">
                            <img src={imagePreviewUrl} alt="Reference preview" className="h-20 w-20 rounded-xl object-cover" />
                            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{imageFileName ?? "Reference image"}</div><div className="mt-1 text-xs text-emerald-400">{isUploadingImage ? "Uploading..." : "Image ready"}</div></div>
                            <span className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60">Replace</span>
                          </div>
                        ) : (
                          <div className="py-4 text-center"><ImageIcon size={26} className="mx-auto text-white/30" /><div className="mt-3 text-sm font-medium">{isUploadingImage ? "Uploading image..." : "Choose a reference image"}</div><div className="mt-1 text-xs text-white/30">Upload the visual you want to animate</div></div>
                        )}
                      </label>
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SelectField label="Duration" value={String(duration)} onChange={(value) => setDuration(value === "3" ? 3 : 5)} options={[["3", "3 seconds"], ["5", "5 seconds"]]} />
                    <label className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                      <div><div className="text-sm font-medium text-white/80">Polish my prompt</div><div className="mt-1 text-xs text-white/30">Improve creative direction before generation.</div></div>
                      <input type="checkbox" checked={enhancePrompt} onChange={(event) => setEnhancePrompt(event.target.checked)} className="h-4 w-4 accent-white" />
                    </label>
                  </div>

                  {error && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-5 text-white/30">Your price is calculated server-side from the active pricing policy.</div>
                    <button type="button" disabled={!canGenerate} onClick={() => void handleGenerate()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-35">
                      {isSubmitting ? <><LoaderCircle size={16} className="animate-spin" /> Starting...</> : <><Sparkles size={16} /> Generate video</>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[30px] border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
                  <div className="flex items-center justify-between"><div><div className="text-sm font-semibold">{generationCardTitle}</div><div className="mt-1 text-xs text-white/30">Your latest creation</div></div>{currentJob && <StatusPill status={currentJob.status} />}</div>
                  {!currentJob ? (
                    <div className="mt-5 grid min-h-[440px] place-items-center rounded-[24px] border border-dashed border-white/[0.08] bg-black/15 text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/[0.05]"><Play size={24} className="text-white/35" /></div><div className="mt-4 text-sm text-white/55">Your preview will appear here.</div><div className="mt-1 text-xs text-white/25">Choose a mode, describe the idea, then generate.</div></div></div>
                  ) : (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
                      {mainOutput ? (
                        <div className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-black">
                          <div className="aspect-[9/14] overflow-hidden bg-black">{mainOutput.mimeType.startsWith("video/") ? <video src={mainOutput.url} className="h-full w-full object-cover" controls playsInline /> : <img src={mainOutput.url} alt="Generated output" className="h-full w-full object-cover" />}</div>
                          <div className="flex items-center justify-between p-3"><div className="text-xs text-white/40">Ready</div><a href={mainOutput.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black"><Download size={14} /> Open</a></div>
                        </div>
                      ) : (
                        <div className="rounded-[24px] border border-white/[0.08] bg-black/20 p-5">
                          <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]"><div className="aspect-[9/14]" />{!terminalStatuses.has(currentJob.status) && <div className="absolute inset-x-8 bottom-8"><div className="mb-3 flex justify-between text-xs"><span className="text-white/45">{statusLabel(currentJob.status)}</span><span>{currentJob.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><motion.div animate={{ width: `${Math.max(4, currentJob.progress)}%` }} className="h-full rounded-full bg-white" /></div></div>}</div>
                          <div className="mt-5"><StatusTimeline status={currentJob.status} /></div>
                          {!terminalStatuses.has(currentJob.status) && <button type="button" onClick={() => void handleCancel()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/65 hover:bg-white/5"><Square size={13} /> Cancel generation</button>}
                          {currentJob.error && <div className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-200">{currentJob.error.message}</div>}
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
                {currentJob && <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-xs text-white/35"><div className="flex justify-between"><span>Job</span><span className="font-mono">{currentJob.id.slice(0, 8)}...</span></div><div className="mt-2 flex justify-between"><span>Created</span><span>{formatDate(currentJob.createdAt)}</span></div></div>}
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
  onModeChange: (mode: "login" | "register") => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const [socialNotice, setSocialNotice] = useState<string | null>(null);
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d0f14] text-white">
      <div className="pointer-events-none absolute inset-0"><div className="absolute -left-32 -top-40 h-[500px] w-[500px] rounded-full bg-fuchsia-500/12 blur-[120px]" /><div className="absolute -bottom-48 -right-32 h-[550px] w-[550px] rounded-full bg-cyan-400/10 blur-[120px]" /></div>
      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/45"><Sparkles size={13} /> AI Creative Studio</div>
          <h1 className="mt-7 max-w-3xl text-6xl font-semibold leading-[0.98] tracking-[-0.055em] xl:text-7xl">Your next idea<span className="block text-white/35">starts here.</span></h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-white/40">Create cinematic AI videos from a single idea. Use natural language in English, हिंदी, मराठी, 中文 or other Unicode scripts.</p>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">{[["01", "Describe"], ["02", "Generate"], ["03", "Publish"]].map(([number, label]) => <div key={number} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="text-[10px] uppercase tracking-[0.18em] text-white/25">{number}</div><div className="mt-2 text-sm font-medium text-white/70">{label}</div></div>)}</div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="mb-7 text-center lg:hidden"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-black"><Sparkles size={20} /></div><div className="mt-4 text-sm font-semibold tracking-[0.14em]">AK VISION AI</div></div>
          <div className="rounded-[32px] border border-white/[0.08] bg-white/[0.045] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8">
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">{mode === "login" ? "Welcome back." : "Build something remarkable."}</h2>
            <p className="mt-2 text-sm leading-6 text-white/35">{mode === "login" ? "Sign in and continue creating." : "Your creative workspace is ready when you are."}</p>
            {mode === "login" && <><div className="mt-7"><button type="button" aria-label="Continue with Google" onClick={() => { setSocialNotice(null); window.location.assign("/api/v1/auth/google/start"); }} className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 text-sm font-medium transition hover:bg-white/[0.06]"><span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[13px] font-bold text-black">G</span>Continue with Google</button></div><div className="mt-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/20"><div className="h-px flex-1 bg-white/[0.08]" /><span>OR</span><div className="h-px flex-1 bg-white/[0.08]" /></div></>}
            <div className="mt-7 space-y-4">
              {mode === "register" && <label className="block"><span className="mb-2 block text-xs text-white/40">Display name</span><div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4"><UserPlus size={16} className="text-white/25" /><input value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} autoComplete="name" className="w-full bg-transparent py-3.5 text-sm outline-none" placeholder="Your name" /></div></label>}
              <label className="block"><span className="mb-2 block text-xs text-white/40">Email</span><div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4"><Mail size={16} className="text-white/25" /><input value={email} onChange={(event) => onEmailChange(event.target.value)} type="email" autoComplete="email" className="w-full bg-transparent py-3.5 text-sm outline-none" placeholder="you@example.com" /></div></label>
              <label className="block"><span className="mb-2 block text-xs text-white/40">Password</span><div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4"><LockKeyhole size={16} className="text-white/25" /><input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full bg-transparent py-3.5 text-sm outline-none" placeholder="••••••••" onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} /></div></label>
            </div>
            {(error || socialNotice) && <div className={["mt-4 rounded-2xl border px-4 py-3 text-sm leading-5", socialNotice && !error ? "border-white/[0.08] bg-white/[0.035] text-white/55" : "border-red-400/20 bg-red-400/5 text-red-200"].join(" ")}>{error || socialNotice}</div>}
            <button type="button" onClick={onSubmit} disabled={submitting} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40">{submitting ? <><LoaderCircle size={16} className="animate-spin" /> {mode === "login" ? "Signing in..." : "Creating account..."}</> : <>{mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />} {mode === "login" ? "Enter studio" : "Create my studio"}</>}</button>
            <div className="mt-5 text-center text-xs text-white/35">{mode === "login" ? <>Don't have an account? <button type="button" onClick={() => onModeChange("register")} className="font-medium text-white/70">Create account</button></> : <>Already have an account? <button type="button" onClick={() => onModeChange("login")} className="font-medium text-white/70">Sign in</button></>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="relative block rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="text-xs text-white/40">{label}</div>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full appearance-none bg-transparent pr-6 text-sm outline-none">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue} className="bg-[#11131a]">{optionLabel}</option>)}
      </select>
      <span className="pointer-events-none absolute bottom-5 right-4 text-white/35">⌄</span>
    </label>
  );
}

function StatusPill({ status }: { status: GenerationJob["status"] }) {
  const tone = statusTone(status);
  return <div className={["inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em]", tone === "success" ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : tone === "danger" ? "border-red-400/20 bg-red-400/5 text-red-200" : tone === "muted" ? "border-white/10 bg-white/[0.03] text-white/35" : "border-cyan-300/15 bg-cyan-300/5 text-cyan-100"].join(" ")}>{tone === "active" ? <LoaderCircle size={11} className="animate-spin" /> : tone === "success" ? <Check size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />} {statusLabel(status)}</div>;
}

function StatusTimeline({ status }: { status: GenerationJob["status"] }) {
  const stages = [["queued", "Queued"], ["processing", "Generating"], ["completed", "Ready"]] as const;
  const currentIndex = status === "queued" ? 0 : status === "processing" ? 1 : status === "completed" ? 2 : -1;
  return <div className="space-y-3">{stages.map(([stage, label], index) => { const done = currentIndex >= index; return <div key={stage} className="flex items-center gap-3"><div className={["grid h-7 w-7 place-items-center rounded-full border", done ? "border-white/20 bg-white text-black" : "border-white/10 bg-white/[0.025] text-white/20"].join(" ")}>{done ? <Check size={13} /> : index + 1}</div><div className={done ? "text-xs text-white/75" : "text-xs text-white/25"}>{label}</div>{index < stages.length - 1 && <div className="ml-auto h-px flex-1 bg-white/[0.06]" />}</div>; })}{(status === "failed" || status === "cancelled") && <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-xs text-white/40">{status === "failed" ? "The generation stopped with an error." : "The generation was cancelled."}</div>}</div>;
}

export default App;
