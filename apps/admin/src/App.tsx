import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Eye,
  Filter,
  CircleDollarSign,
  Gauge,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  createUser,
  deleteUser,
  getAdminGeneration,
  getAdminGenerations,
  getAdminCredits,
  getAdminCreditDetail,
  grantAdminCredits,
  getCurrentUser,
  getDbHealth,
  getHealth,
  getUsers,
  login,
  logout,
  updateUser,
  type AccountType,
  type AdminCreditBalance,
  type AdminCreditDetail,
  type AdminGeneration,
  type AdminGenerationDetail,
  type GenerationStatus,
  type AuthUser,
  type ManagedUser,
  type UserRole,
  type UserStatus,
} from "./api";

type Section = "dashboard" | "users" | "generations" | "credits" | "providers" | "audit" | "settings";

const sections: Array<{ id: Section; label: string; icon: typeof LayoutDashboard; live?: boolean }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, live: true },
  { id: "users", label: "Users", icon: Users, live: true },
  { id: "generations", label: "Generations", icon: Activity, live: true },
  { id: "credits", label: "Credits & Billing", icon: CircleDollarSign, live: true },
  { id: "providers", label: "Providers", icon: Gauge },
  { id: "audit", label: "Audit Logs", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: ShieldCheck },
];

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || email.slice(0, 2)).toUpperCase();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function statusClass(status: UserStatus) {
  if (status === "active") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (status === "suspended") return "border-red-400/20 bg-red-400/10 text-red-200";
  return "border-amber-300/20 bg-amber-300/10 text-amber-100";
}

function roleLabel(role: string) {
  return role === "super_admin" ? "Super Admin" : role === "admin" ? "Admin" : "Customer";
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [health, setHealth] = useState<{ api: boolean; db: boolean }>({ api: false, db: false });
  const [generations, setGenerations] = useState<AdminGeneration[]>([]);
  const [generationsLoading, setGenerationsLoading] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationPage, setGenerationPage] = useState(1);
  const [generationPageSize] = useState(20);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | "">("");
  const [generationSearchInput, setGenerationSearchInput] = useState("");
  const [generationSearch, setGenerationSearch] = useState("");
  const [generationMeta, setGenerationMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [selectedGeneration, setSelectedGeneration] = useState<AdminGenerationDetail | null>(null);
  const [generationDetailLoading, setGenerationDetailLoading] = useState(false);
  const [generationDetailError, setGenerationDetailError] = useState<string | null>(null);

  const refreshUsers = useCallback(async () => {
    setUsersLoading(true);
    setPageError(null);
    try {
      const response = await getUsers();
      setUsers(response.data);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const refreshGenerations = useCallback(async () => {
    setGenerationsLoading(true);
    setGenerationError(null);
    try {
      const response = await getAdminGenerations({
        page: generationPage,
        pageSize: generationPageSize,
        status: generationStatus,
        search: generationSearch,
      });
      setGenerations(response.data);
      setGenerationMeta(response.meta);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Could not load generations.");
    } finally {
      setGenerationsLoading(false);
    }
  }, [generationPage, generationPageSize, generationStatus, generationSearch]);

  const refreshHealth = useCallback(async () => {
    const [api, db] = await Promise.allSettled([getHealth(), getDbHealth()]);
    setHealth({
      api: api.status === "fulfilled" && api.value,
      db: db.status === "fulfilled" && db.value,
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void getCurrentUser()
      .then((user) => {
        if (!mounted) return;
        setAuthUser(user);
        if (user && ["admin", "super_admin"].includes(user.role)) {
          void refreshUsers();
          void refreshHealth();
        }
      })
      .catch((error) => { if (mounted) setAuthError(error instanceof Error ? error.message : "Could not restore session."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refreshHealth, refreshUsers]);

  useEffect(() => {
    if (!authUser || !["admin", "super_admin"].includes(authUser.role) || section !== "generations") return;
    void refreshGenerations();
  }, [authUser, section, refreshGenerations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGenerationPage(1);
      setGenerationSearch(generationSearchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [generationSearchInput]);

  async function openGeneration(jobId: string) {
    setGenerationDetailLoading(true);
    setGenerationDetailError(null);
    try {
      const response = await getAdminGeneration(jobId);
      setSelectedGeneration(response.data);
    } catch (error) {
      setGenerationDetailError(error instanceof Error ? error.message : "Could not load generation details.");
    } finally {
      setGenerationDetailLoading(false);
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password) { setAuthError("Enter your admin email and password."); return; }
    setSubmitting(true);
    setAuthError(null);
    try {
      const response = await login(email.trim(), password);
      if (!["admin", "super_admin"].includes(response.data.user.role)) {
        await logout().catch(() => undefined);
        throw new Error("This account does not have admin access.");
      }
      setAuthUser(response.data.user);
      await Promise.all([refreshUsers(), refreshHealth()]);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Admin sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    setAuthUser(null);
    setUsers([]);
    setGenerations([]);
    setSelectedGeneration(null);
    setSection("dashboard");
  }

  async function handleToggleStatus(user: ManagedUser) {
    const nextStatus: UserStatus = user.status === "suspended" ? "active" : "suspended";
    try {
      const response = await updateUser(user.id, { status: nextStatus });
      setUsers((items) => items.map((item) => item.id === user.id ? response.data : item));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not update user status.");
    }
  }

  async function handleDelete(user: ManagedUser) {
    if (!window.confirm(`Delete ${user.displayName}? This cannot be undone.`)) return;
    try {
      await deleteUser(user.id);
      setUsers((items) => items.filter((item) => item.id !== user.id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not delete user.");
    }
  }

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => [user.displayName, user.email, user.role, user.status, user.accountType].some((value) => value.toLowerCase().includes(needle)));
  }, [search, users]);

  const customerCount = users.filter((user) => user.role === "customer").length;
  const activeCount = users.filter((user) => user.status === "active").length;
  const suspendedCount = users.filter((user) => user.status === "suspended").length;
  const adminCount = users.filter((user) => user.role !== "customer").length;

  if (loading) return <div className="grid min-h-screen place-items-center text-white"><div className="text-sm text-white/50">Opening AK Vision AI Admin Console…</div></div>;

  if (!authUser || !["admin", "super_admin"].includes(authUser.role)) {
    return <LoginScreen email={email} password={password} error={authError} submitting={submitting} setEmail={setEmail} setPassword={setPassword} onSubmit={() => void handleLogin()} />;
  }

  return (
    <div className="min-h-screen text-white">
      <div className="flex min-h-screen">
        <aside className={["fixed inset-y-0 left-0 z-50 w-72 border-r border-white/[0.07] bg-[#0d1016]/95 p-5 backdrop-blur-2xl transition-transform lg:static lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full"].join(" ")}>
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-2">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black"><ShieldCheck size={19} /></div>
              <div><div className="text-sm font-semibold tracking-wide">AK VISION AI</div><div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Admin Console</div></div>
            </div>
            <div className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 text-xs text-white/45"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Internal operations</div><div className="mt-2 text-white/65">{roleLabel(authUser.role)}</div></div>
            <nav className="mt-6 space-y-1">
              {sections.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return <button key={item.id} type="button" onClick={() => { setSection(item.id); setMobileOpen(false); }} className={["flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition", active ? "bg-white/[0.09] text-white" : "text-white/45 hover:bg-white/[0.04] hover:text-white"].join(" ")}><Icon size={17} /><span>{item.label}</span>{!item.live && <span className="ml-auto rounded-full border border-white/[0.08] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/25">Soon</span>}</button>;
              })}
            </nav>
            <div className="mt-auto border-t border-white/[0.07] pt-4">
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.08] text-xs font-semibold">{initials(authUser.displayName, authUser.email)}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{authUser.displayName}</div><div className="truncate text-[10px] text-white/30">{authUser.email}</div></div></div>
              <button type="button" onClick={() => void handleLogout()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2.5 text-xs text-white/45 hover:bg-white/[0.04] hover:text-white"><LogOut size={14} /> Sign out</button>
            </div>
          </div>
        </aside>

        {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-black/60 lg:hidden" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#090b10]/85 backdrop-blur-xl">
            <div className="flex h-16 items-center gap-3 px-5 lg:px-8"><button type="button" className="rounded-xl p-2 text-white/50 lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="min-w-0 flex-1"><div className="text-xs text-white/30">AK Vision AI / {sections.find((item) => item.id === section)?.label}</div></div><button type="button" onClick={() => { void refreshHealth(); if (section === "users") void refreshUsers(); if (section === "generations") void refreshGenerations(); }} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-xs text-white/55 hover:bg-white/[0.04]"><RefreshCcw size={13} /> Refresh</button></div>
          </header>

          <div className="mx-auto max-w-[1480px] p-5 lg:p-8">
            {section === "dashboard" && <DashboardView users={users} customerCount={customerCount} activeCount={activeCount} suspendedCount={suspendedCount} adminCount={adminCount} health={health} />}
            {section === "credits" && <CreditsView />}
            {section === "users" && <UsersView authUser={authUser} users={filteredUsers} totalUsers={users.length} search={search} setSearch={setSearch} loading={usersLoading} error={pageError} onCreate={() => { setEditingUser(null); setModal("create"); }} onEdit={(user) => { setEditingUser(user); setModal("edit"); }} onToggle={handleToggleStatus} onDelete={handleDelete} />}
            {section === "generations" && (
  <GenerationsView
    generations={generations}
    loading={generationsLoading}
    error={generationError}
    page={generationMeta.page}
    totalPages={generationMeta.totalPages}
    total={generationMeta.total}
    search={generationSearchInput}
    status={generationStatus}
    setSearch={setGenerationSearchInput}
    setStatus={setGenerationStatus}
    onPrev={() => setGenerationPage((value) => Math.max(1, value - 1))}
    onNext={() => setGenerationPage((value) => Math.min(generationMeta.totalPages, value + 1))}
    onOpen={(jobId) => void openGeneration(jobId)}
  />
)}
{!(["dashboard", "users", "generations"] as Section[]).includes(section) && <ComingSoon title={sections.find((item) => item.id === section)?.label ?? "Module"} />}
          </div>
        </main>
      </div>

      {selectedGeneration && (
        <GenerationDetailDrawer
          generation={selectedGeneration}
          loading={generationDetailLoading}
          error={generationDetailError}
          onClose={() => {
            setSelectedGeneration(null);
            setGenerationDetailError(null);
          }}
        />
      )}

      {modal && <UserModal mode={modal} actorRole={authUser.role} user={editingUser} onClose={() => setModal(null)} onSaved={(user) => { setUsers((items) => modal === "create" ? [user, ...items] : items.map((item) => item.id === user.id ? user : item)); setModal(null); }} />}
    </div>
  );
}

function LoginScreen({ email, password, error, submitting, setEmail, setPassword, onSubmit }: { email: string; password: string; error: string | null; submitting: boolean; setEmail: (v: string) => void; setPassword: (v: string) => void; onSubmit: () => void }) {
  return <div className="grid min-h-screen place-items-center p-5"><div className="w-full max-w-md rounded-[30px] border border-white/[0.08] bg-white/[0.045] p-7 shadow-[0_40px_120px_rgba(0,0,0,.4)]"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-black"><ShieldCheck size={21} /></div><h1 className="mt-5 text-center text-2xl font-semibold">Admin Console</h1><p className="mt-2 text-center text-sm leading-6 text-white/35">Authorized AK Vision AI administrators only.</p><div className="mt-7 space-y-4"><label className="block"><span className="mb-2 block text-xs text-white/40">Admin email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3.5 text-sm outline-none" placeholder="admin@example.com" /></label><label className="block"><span className="mb-2 block text-xs text-white/40">Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }} type="password" autoComplete="current-password" className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3.5 text-sm outline-none" placeholder="••••••••" /></label></div>{error && <div className="mt-4 flex gap-3 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}<button type="button" disabled={submitting} onClick={onSubmit} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-black disabled:opacity-40">{submitting ? "Signing in…" : <><LogIn size={16} /> Enter Admin Console</>}</button></div></div>;
}

function DashboardView({ users, customerCount, activeCount, suspendedCount, adminCount, health }: { users: ManagedUser[]; customerCount: number; activeCount: number; suspendedCount: number; adminCount: number; health: { api: boolean; db: boolean } }) {
  const cards = [
    ["Total users", String(users.length), Users],
    ["Customers", String(customerCount), Users],
    ["Active accounts", String(activeCount), CheckCircle2],
    ["Admins", String(adminCount), ShieldCheck],
  ] as const;
  return <div><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] uppercase tracking-[0.2em] text-white/30">Operations overview</div><h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Good morning, Admin.</h1><p className="mt-2 text-sm text-white/35">Real platform data only. Placeholder modules stay visibly unimplemented.</p></div><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs text-white/45">{new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div></div><div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5"><div className="flex items-center justify-between text-white/35"><span className="text-xs">{label}</span><Icon size={17} /></div><div className="mt-5 text-3xl font-semibold">{value}</div></div>)}</div><div className="mt-6 grid gap-5 xl:grid-cols-[1fr_380px]"><div className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold">Account health</div><div className="mt-1 text-xs text-white/30">Live counts from the admin users API.</div></div><ChevronRight size={16} className="text-white/20" /></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"><div className="text-xs text-white/35">Suspended accounts</div><div className="mt-2 text-xl font-semibold">{suspendedCount}</div></div><div className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"><div className="text-xs text-white/35">Pending accounts</div><div className="mt-2 text-xl font-semibold">{users.filter((u) => u.status === "pending").length}</div></div></div></div><div className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5"><div className="text-sm font-semibold">System health</div><div className="mt-4 space-y-3"><HealthRow label="API" ok={health.api} /><HealthRow label="Database" ok={health.db} /></div></div></div></div>;
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return <div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-black/15 px-4 py-3"><span className="text-sm text-white/65">{label}</span><span className={["inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider", ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-red-400/20 bg-red-400/10 text-red-200"].join(" ")}>{ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{ok ? "Healthy" : "Down"}</span></div>;
}

function UsersView({ authUser, users, totalUsers, search, setSearch, loading, error, onCreate, onEdit, onToggle, onDelete }: { authUser: AuthUser; users: ManagedUser[]; totalUsers: number; search: string; setSearch: (v: string) => void; loading: boolean; error: string | null; onCreate: () => void; onEdit: (u: ManagedUser) => void; onToggle: (u: ManagedUser) => void; onDelete: (u: ManagedUser) => void }) {
  return <div><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[11px] uppercase tracking-[0.2em] text-white/30">Identity & access</div><h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Users</h1><p className="mt-2 text-sm text-white/35">Manage customer and privileged accounts through the existing role-protected API.</p></div><button type="button" onClick={onCreate} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"><Plus size={16} /> Create user</button></div><div className="mt-7 rounded-3xl border border-white/[0.08] bg-white/[0.035] p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-2xl border border-white/[0.07] bg-black/15 py-3 pl-10 pr-4 text-sm outline-none" placeholder={`Search ${totalUsers} users…`} /></div><div className="text-xs text-white/30">Showing {users.length} / {totalUsers}</div></div></div>{error && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}<div className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025]"><div className="overflow-x-auto"><table className="min-w-[920px] w-full text-left"><thead className="border-b border-white/[0.07] bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/25"><tr><th className="px-5 py-4">User</th><th className="px-5 py-4">Role</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Account</th><th className="px-5 py-4">Created</th><th className="px-5 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{loading ? <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-white/30">Loading users…</td></tr> : users.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-white/30">No users match this search.</td></tr> : users.map((user) => <tr key={user.id} tabIndex={0} role="button" title="Click to open user" onClick={() => onEdit(user)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onEdit(user); } }} className="cursor-pointer hover:bg-white/[0.04] focus:bg-white/[0.05] focus:outline-none"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.08] text-xs font-semibold">{initials(user.displayName, user.email)}</div><div className="min-w-0"><div className="truncate text-sm font-medium">{user.displayName}</div><div className="truncate text-xs text-white/30">{user.email}</div></div></div></td><td className="px-5 py-4 text-sm text-white/60">{roleLabel(user.role)}</td><td className="px-5 py-4"><span className={["inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider", statusClass(user.status)].join(" ")}>{user.status}</span></td><td className="px-5 py-4 text-xs uppercase tracking-wider text-white/35">{user.accountType}</td><td className="px-5 py-4 text-xs text-white/35">{formatDate(user.createdAt)}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); onEdit(user); }} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/55 hover:bg-white/[0.04]">Edit</button><button type="button" disabled={user.role === "super_admin" && user.id !== authUser.id} onClick={(event) => { event.stopPropagation(); void onToggle(user); }} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/55 hover:bg-white/[0.04] disabled:opacity-25">{user.status === "suspended" ? "Activate" : "Suspend"}</button><button type="button" disabled={user.role === "super_admin"} onClick={(event) => { event.stopPropagation(); void onDelete(user); }} className="rounded-xl border border-red-400/15 px-3 py-2 text-xs text-red-200/70 hover:bg-red-400/5 disabled:opacity-25">Delete</button></div></td></tr>)}</tbody></table></div></div></div>;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function generationStatusClass(status: GenerationStatus) {
  if (status === "completed") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (status === "failed") return "border-red-400/20 bg-red-400/10 text-red-200";
  if (status === "cancelled") return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  if (status === "processing") return "border-sky-400/20 bg-sky-400/10 text-sky-200";
  return "border-white/[0.10] bg-white/[0.04] text-white/60";
}

function formatBytes(value: number | null | undefined) {
  if (!value || value < 1) return "—";
  if (value < 1024) return String(value) + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
  return (value / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

function GenerationsView(props: {
  generations: AdminGeneration[];
  loading: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  total: number;
  search: string;
  status: GenerationStatus | "";
  setSearch: (value: string) => void;
  setStatus: (value: GenerationStatus | "") => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (jobId: string) => void;
}) {
  const { generations, loading, error, page, totalPages, total, search, status, setSearch, setStatus, onPrev, onNext, onOpen } = props;
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/30">Generation operations</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Generations</h1>
          <p className="mt-2 text-sm text-white/35">Live generation jobs from the database. Operational metadata only.</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs text-white/40">
          {total.toLocaleString("en-IN")} jobs
        </div>
      </div>

      <div className="mt-7 rounded-3xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-white/[0.07] bg-black/15 py-3 pl-10 pr-4 text-sm outline-none" placeholder="Search customer, provider, model, job ID or request ID…" />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-white/25" />
            <select value={status} onChange={(event) => setStatus(event.target.value as GenerationStatus | "")} className="rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3 text-sm outline-none">
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025]">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-left">
            <thead className="border-b border-white/[0.07] bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/25">
              <tr><th className="px-5 py-4">Customer</th><th className="px-5 py-4">Generation</th><th className="px-5 py-4">Mode</th><th className="px-5 py-4">Provider / Model</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Created</th><th className="px-5 py-4 text-right">View</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-white/30">Loading generations…</td></tr>
              ) : generations.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-white/30">No generation jobs match the current filters.</td></tr>
              ) : generations.map((generation) => (
                <tr key={generation.id} tabIndex={0} role="button" title="Click to open generation" onClick={() => onOpen(generation.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(generation.id); } }} className="cursor-pointer hover:bg-white/[0.04] focus:bg-white/[0.05] focus:outline-none">
                  <td className="px-5 py-4"><div className="max-w-[230px]"><div className="truncate text-sm font-medium">{generation.customer.displayName}</div><div className="truncate text-xs text-white/30">{generation.customer.email}</div></div></td>
                  <td className="px-5 py-4"><div className="text-xs font-medium text-white/65">{generation.type}</div><div className="mt-1 max-w-[260px] truncate text-[11px] text-white/30">{generation.prompt || "No prompt"}</div><div className="mt-1 font-mono text-[10px] text-white/20">{generation.id.slice(0, 12)}…</div></td>
                  <td className="px-5 py-4 text-xs text-white/55">{generation.mode || "—"}</td>
                  <td className="px-5 py-4"><div className="text-xs text-white/60">{generation.providerId || "—"}</div><div className="mt-1 text-[10px] text-white/25">{generation.providerModelId || "—"}</div></td>
                  <td className="px-5 py-4"><div className="space-y-2"><span className={["inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider", generationStatusClass(generation.status)].join(" ")}>{generation.status}</span><div className="w-28"><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-white/60" style={{ width: Math.max(0, Math.min(100, generation.progress)) + "%" }} /></div><div className="mt-1 text-[9px] text-white/20">{Math.round(generation.progress)}%</div></div></div></td>
                  <td className="px-5 py-4 text-xs text-white/35">{formatDateTime(generation.createdAt)}</td>
                  <td className="px-5 py-4 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(generation.id); }} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/55 hover:bg-white/[0.04] hover:text-white"><Eye size={14} /> View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.07] px-5 py-4">
          <div className="text-xs text-white/25">Page {page} of {Math.max(1, totalPages)}</div>
          <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={onPrev} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/50 disabled:opacity-25">Previous</button><button type="button" disabled={page >= totalPages} onClick={onNext} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/50 disabled:opacity-25">Next</button></div>
        </div>
      </div>
    </div>
  );
}


function CreditsView() {
  const [items, setItems] = useState<AdminCreditBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [meta, setMeta] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<AdminCreditDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [grantTarget, setGrantTarget] = useState<AdminCreditDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [granting, setGranting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminCredits({ page, pageSize, search });
      setItems(response.data);
      setMeta(response.meta);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load credit accounts.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPage(1), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function openCustomer(userId: string) {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await getAdminCreditDetail(userId);
      setSelected(response.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load credit details.");
    } finally {
      setDetailLoading(false);
    }
  }

  function openGrant(detail: AdminCreditDetail) {
    setGrantTarget(detail);
    setAmount("");
    setDescription("");
    setReferenceId("");
    setNotice(null);
  }

  async function submitGrant() {
    if (!grantTarget) return;
    const numericAmount = Number(amount);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      setNotice("Enter a positive whole number of credits.");
      return;
    }

    setGranting(true);
    setNotice(null);
    try {
      await grantAdminCredits(grantTarget.customer.id, {
        amount: numericAmount,
        description: description.trim() || undefined,
        referenceId: referenceId.trim() || undefined,
        idempotencyKey: "admin-ui:" + grantTarget.customer.id + ":" + crypto.randomUUID(),
      });
      await Promise.all([refresh(), openCustomer(grantTarget.customer.id)]);
      setGrantTarget(null);
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "Credit grant failed.");
    } finally {
      setGranting(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/30">Financial operations</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Credits & Billing</h1>
          <p className="mt-2 text-sm text-white/35">Live customer wallets, reservations, usage and immutable credit ledger activity.</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs text-white/40">
          {meta.total.toLocaleString("en-IN")} customer wallets
        </div>
      </div>

      <div className="mt-7 rounded-3xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-white/[0.07] bg-black/15 py-3 pl-10 pr-4 text-sm outline-none" placeholder="Search customer email or name…" />
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] px-4 py-3 text-xs text-white/55 hover:bg-white/[0.04]"><RefreshCcw size={14} /> Refresh</button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025]">
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full text-left">
            <thead className="border-b border-white/[0.07] bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/25">
              <tr><th className="px-5 py-4">Customer</th><th className="px-5 py-4">Available</th><th className="px-5 py-4">Reserved</th><th className="px-5 py-4">Total</th><th className="px-5 py-4">Updated</th><th className="px-5 py-4 text-right">View</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading ? <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-white/30">Loading credit accounts…</td></tr> :
              items.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-white/30">No customer credit accounts found.</td></tr> :
              items.map((item) => (
                <tr key={item.id} tabIndex={0} role="button" onClick={() => void openCustomer(item.customer.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openCustomer(item.customer.id); } }} className="cursor-pointer hover:bg-white/[0.04] focus:bg-white/[0.05] focus:outline-none">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.08] text-xs font-semibold">{initials(item.customer.displayName, item.customer.email)}</div><div><div className="text-sm font-medium">{item.customer.displayName}</div><div className="text-xs text-white/30">{item.customer.email}</div></div></div></td>
                  <td className="px-5 py-4 text-sm font-semibold">{item.balance?.availableCredits ?? 0}</td>
                  <td className="px-5 py-4 text-sm text-amber-100/75">{item.balance?.reservedCredits ?? 0}</td>
                  <td className="px-5 py-4 text-sm text-white/65">{item.totalCredits}</td>
                  <td className="px-5 py-4 text-xs text-white/35">{item.balance ? formatDateTime(item.balance.updatedAt) : "Never"}</td>
                  <td className="px-5 py-4 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); void openCustomer(item.customer.id); }} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/55 hover:bg-white/[0.04]">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.07] px-5 py-4"><div className="text-xs text-white/25">Page {page} of {Math.max(1, meta.totalPages)}</div><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/50 disabled:opacity-25">Previous</button><button type="button" disabled={page >= meta.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/50 disabled:opacity-25">Next</button></div></div>
      </div>

      {selected && <div className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm"><button type="button" aria-label="Close credit details" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setSelected(null)} /><aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-white/[0.08] bg-[#10131a] p-6 shadow-[-30px_0_100px_rgba(0,0,0,.45)]"><div className="flex items-center justify-between"><div><div className="text-[11px] uppercase tracking-[0.2em] text-white/25">Customer wallet</div><h2 className="mt-2 text-xl font-semibold">{selected.customer.displayName}</h2><div className="mt-1 text-xs text-white/30">{selected.customer.email}</div></div><button type="button" onClick={() => setSelected(null)} className="rounded-xl p-2 text-white/40 hover:bg-white/[0.04]"><X size={18} /></button></div>{detailLoading ? <div className="mt-6 text-sm text-white/30">Loading wallet details…</div> : <div className="mt-6 space-y-5"><div className="grid gap-3 sm:grid-cols-3"><InfoBox label="Available" value={String(selected.balance?.availableCredits ?? 0)} sub={selected.balance?.currency ?? "INR"} /><InfoBox label="Reserved" value={String(selected.balance?.reservedCredits ?? 0)} sub="Currently held" /><InfoBox label="Total" value={String(selected.totalCredits)} sub="Available + reserved" /></div><div className="flex gap-3"><button type="button" onClick={() => openGrant(selected)} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"><Plus size={15} /> Grant credits</button><button type="button" onClick={() => void openCustomer(selected.customer.id)} className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] px-4 py-3 text-sm text-white/55"><RefreshCcw size={14} /> Refresh</button></div><DetailCard title="Credit ledger">{selected.transactions.length === 0 ? <div className="text-sm text-white/30">No ledger transactions.</div> : <div className="space-y-2">{selected.transactions.map((row) => <div key={row.id} className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-white/70">{row.type} · {row.source}</div><div className="mt-1 text-xs text-white/35">{row.description || "No description"}</div></div><div className="text-sm font-semibold">+{row.amount}</div></div><div className="mt-2 flex flex-wrap gap-4 text-[10px] text-white/20"><span>Available {row.availableBalanceAfter}</span><span>Reserved {row.reservedBalanceAfter}</span><span>{formatDateTime(row.createdAt)}</span></div></div>)}</div>}</DetailCard><DetailCard title="Reservations">{selected.reservations.length === 0 ? <div className="text-sm text-white/30">No reservations.</div> : <div className="space-y-2">{selected.reservations.slice(0, 10).map((row) => <div key={row.id} className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-black/15 p-4"><div><div className="text-sm font-medium text-white/70">{row.status}</div><div className="mt-1 text-[10px] text-white/25">{row.referenceId || "No reference"}</div></div><div className="text-sm text-amber-100/75">{row.amount}</div></div>)}</div>}</DetailCard><DetailCard title="Usage">{selected.usage.length === 0 ? <div className="text-sm text-white/30">No usage records.</div> : <div className="overflow-x-auto"><table className="min-w-[720px] w-full text-left"><thead className="text-[10px] uppercase tracking-[0.16em] text-white/20"><tr><th className="pb-3">Provider</th><th className="pb-3">Model</th><th className="pb-3">Credits</th><th className="pb-3">Customer charge</th><th className="pb-3">Date</th></tr></thead><tbody>{selected.usage.map((row) => <tr key={row.id} className="border-t border-white/[0.05]"><td className="py-3 text-xs text-white/55">{row.providerId || "—"}</td><td className="py-3 text-xs text-white/35">{row.providerModelId || "—"}</td><td className="py-3 text-xs">{row.creditsUsed}</td><td className="py-3 text-xs text-white/55">{row.customerChargeMinor == null ? "—" : row.currency + " " + (row.customerChargeMinor / 100).toFixed(2)}</td><td className="py-3 text-xs text-white/25">{formatDateTime(row.createdAt)}</td></tr>)}</tbody></table></div>}</DetailCard></div>}</aside></div>}

      {grantTarget && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><div className="w-full max-w-lg rounded-[30px] border border-white/[0.09] bg-[#10131a] p-6 shadow-[0_40px_120px_rgba(0,0,0,.55)]"><div className="flex items-center justify-between"><div><div className="text-lg font-semibold">Grant credits</div><div className="mt-1 text-xs text-white/30">{grantTarget.customer.email}</div></div><button type="button" onClick={() => setGrantTarget(null)} className="rounded-xl p-2 text-white/40 hover:bg-white/[0.04]"><X size={18} /></button></div><div className="mt-6 space-y-4"><label className="block"><span className="mb-2 block text-xs text-white/40">Amount</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none" placeholder="e.g. 500" /></label><label className="block"><span className="mb-2 block text-xs text-white/40">Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none" placeholder="Support compensation" /></label><label className="block"><span className="mb-2 block text-xs text-white/40">Reference (optional)</span><input value={referenceId} onChange={(event) => setReferenceId(event.target.value)} className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none" placeholder="SUPPORT-001" /></label></div>{notice && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{notice}</div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setGrantTarget(null)} className="rounded-2xl border border-white/[0.08] px-4 py-3 text-sm text-white/55">Cancel</button><button type="button" disabled={granting} onClick={() => void submitGrant()} className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black disabled:opacity-40">{granting ? "Granting…" : "Grant credits"}</button></div></div></div>}
    </div>
  );
}


function GenerationDetailDrawer(props: {
  generation: AdminGenerationDetail;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { generation, loading, error, onClose } = props;
  return (
    <div className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm">
      <button type="button" aria-label="Close generation details" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-white/[0.08] bg-[#10131a] p-6 shadow-[-30px_0_100px_rgba(0,0,0,.45)]">
        <div className="flex items-center justify-between"><div><div className="text-[11px] uppercase tracking-[0.2em] text-white/25">Generation detail</div><h2 className="mt-2 text-xl font-semibold">{generation.id}</h2></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-white/40 hover:bg-white/[0.04]"><X size={18} /></button></div>
        {loading && <div className="mt-6 text-sm text-white/30">Loading generation detail…</div>}
        {error && <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}
        {!loading && !error && <div className="mt-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoBox label="Customer" value={generation.customer.displayName} sub={generation.customer.email} />
            <InfoBox label="Status" value={generation.status} sub={Math.round(generation.progress) + "% progress"} />
            <InfoBox label="Mode" value={generation.mode || "—"} sub={generation.type} />
            <InfoBox label="Provider" value={generation.providerId || "—"} sub={generation.providerModelId || "—"} />
            <InfoBox label="Credits" value={generation.creditsRequired == null ? "—" : String(generation.creditsRequired)} sub="Required credits" />
            <InfoBox label="Outputs" value={String(generation.outputs.length)} sub="Stored artifacts" />
          </div>
          <DetailCard title="Prompt"><div className="whitespace-pre-wrap text-sm leading-6 text-white/65">{generation.prompt || "No prompt recorded."}</div></DetailCard>
          <DetailCard title="Request / lifecycle"><div className="grid gap-3 sm:grid-cols-2"><InfoLine label="Request ID" value={generation.requestId} mono /><InfoLine label="Job ID" value={generation.id} mono /><InfoLine label="Created" value={formatDateTime(generation.createdAt)} /><InfoLine label="Updated" value={formatDateTime(generation.updatedAt)} /><InfoLine label="Started" value={formatDateTime(generation.startedAt)} /><InfoLine label="Completed" value={formatDateTime(generation.completedAt)} /></div></DetailCard>
          {generation.status === "failed" && <DetailCard title="Why this generation failed"><div className="text-sm font-medium text-red-200">{generation.errorCode || "GENERATION_FAILED"}</div>{generation.errorMessage ? <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/50">{generation.errorMessage}</div> : <div className="mt-2 text-sm leading-6 text-white/35">No detailed failure message was recorded for this job.</div>}</DetailCard>}
          <DetailCard title="Outputs">{generation.outputs.length === 0 ? <div className="text-sm text-white/30">No output artifact recorded.</div> : <div className="space-y-3">{generation.outputs.map((output) => <div key={output.id} className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-white/70">{output.type}</div><div className="mt-1 font-mono text-[10px] text-white/25">{output.id}</div></div><div className="text-xs text-white/30">{formatBytes(output.sizeBytes)}</div></div><div className="mt-2 text-[11px] text-white/25">{output.mimeType || "Unknown MIME type"}</div></div>)}</div>}</DetailCard>
          <DetailCard title="Input summary"><pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-white/35">{JSON.stringify(generation.inputSummary ?? {}, null, 2)}</pre></DetailCard>
        </div>}
      </aside>
    </div>
  );
}

function InfoBox(props: { label: string; value: string; sub?: string }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="text-[10px] uppercase tracking-[0.16em] text-white/20">{props.label}</div><div className="mt-2 truncate text-sm font-medium text-white/70">{props.value}</div>{props.sub && <div className="mt-1 truncate text-[11px] text-white/25">{props.sub}</div>}</div>;
}

function InfoLine(props: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-[10px] uppercase tracking-[0.16em] text-white/20">{props.label}</div><div className={["mt-1 break-all text-xs text-white/45", props.mono ? "font-mono" : ""].join(" ")}>{props.value}</div></div>;
}

function DetailCard(props: { title: string; children: ReactNode }) {
  return <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="mb-4 text-sm font-semibold">{props.title}</div>{props.children}</div>;
}

function UserModal({ mode, actorRole, user, onClose, onSaved }: { mode: "create" | "edit"; actorRole: string; user: ManagedUser | null; onClose: () => void; onSaved: (user: ManagedUser) => void }) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "customer");
  const [status, setStatus] = useState<UserStatus>(user?.status ?? "active");
  const [accountType, setAccountType] = useState<AccountType>(user?.accountType ?? "individual");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowPrivileged = actorRole === "super_admin";

  async function submit() {
    setSaving(true); setError(null);
    try {
      const payload = { displayName: displayName.trim(), email: email.trim(), role, status, accountType };
      if (!payload.displayName || !payload.email) throw new Error("Display name and email are required.");
      const response = mode === "create" ? await createUser(payload) : await updateUser(user!.id, payload);
      onSaved(response.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save user.");
    } finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><div className="w-full max-w-xl rounded-[30px] border border-white/[0.09] bg-[#10131a] p-6 shadow-[0_40px_120px_rgba(0,0,0,.55)]"><div className="flex items-center justify-between"><div><div className="text-lg font-semibold">{mode === "create" ? "Create user" : "Edit user"}</div><div className="mt-1 text-xs text-white/30">Role changes remain protected by the API.</div></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-white/40 hover:bg-white/[0.04]"><X size={18} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="mb-2 block text-xs text-white/40">Display name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none" /></label><label className="block"><span className="mb-2 block text-xs text-white/40">Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none" /></label><label className="block"><span className="mb-2 block text-xs text-white/40">Account type</span><select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)} className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none"><option value="individual">Individual</option><option value="business">Business</option><option value="enterprise">Enterprise</option></select></label><label className="block"><span className="mb-2 block text-xs text-white/40">Role</span><select value={role} disabled={!allowPrivileged} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none"><option value="customer">Customer</option>{allowPrivileged && <><option value="admin">Admin</option><option value="super_admin">Super Admin</option></>}</select></label><label className="block"><span className="mb-2 block text-xs text-white/40">Status</span><select value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} className="w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm outline-none"><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></label></div>{error && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-2xl border border-white/[0.08] px-4 py-3 text-sm text-white/55">Cancel</button><button type="button" disabled={saving} onClick={() => void submit()} className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black disabled:opacity-40">{saving ? "Saving…" : "Save user"}</button></div></div></div>;
}

function ComingSoon({ title }: { title: string }) {
  return <div className="grid min-h-[62vh] place-items-center"><div className="max-w-lg text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03]"><Gauge size={22} className="text-white/30" /></div><h1 className="mt-5 text-3xl font-semibold">{title}</h1><p className="mt-3 text-sm leading-6 text-white/35">This module is intentionally not backed by fake data yet. It will be connected after the corresponding API contract is implemented and tested.</p></div></div>;
}
