# Turath-Mart — Developer Guide

> Internal staff tool. Not a public-facing site. Built on Next.js 15 (App Router) + React 19 + TypeScript + Supabase.

---

## 1. Quick start

```bash
# Install pnpm via corepack (no global install needed; version pinned in package.json)
corepack enable
corepack pnpm install

# Copy the env template and fill in Supabase + VPS values
cp .env.example .env
# edit .env (NEVER commit it — it's in .gitignore)

# Run the dev server on port 4028
pnpm dev
```

Open http://localhost:4028. The middleware redirects unauthenticated requests to `/sign-up-login-screen`.

---

## 2. Required environment variables

| Variable | Purpose | Where used |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | browser + middleware + image-hosts config |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | browser + middleware (NEVER service-role) |
| `NEXT_PUBLIC_SITE_URL` | Canonical site origin | metadata, openGraph |
| `NEXT_PUBLIC_COMPANY_DOMAIN` | Email domain for staff | (reserved) |
| `VPS_IP` / `VPS_USER` / `VPS_PATH` | SSH target for `deploy_vps.sh` | deploy script only |
| `APP_PORT` | PM2 port on the VPS | deploy script only |
| `APP_PATH` | Project path on the VPS | `finalize_deploy.sh` |

**Service-role key is never used in client or middleware.** If you need it later (e.g. for an admin RPC), add a `SUPABASE_SERVICE_ROLE_KEY` env var and use it ONLY inside `src/app/api/**/*.ts` route handlers.

---

## 3. Project layout

```
src/
├── app/                          # Next.js App Router pages
│   ├── crm/                      # Customer relationship management
│   ├── dashboard/
│   ├── inventory/
│   ├── orders-management/        # Orders table + modals
│   ├── reports/
│   ├── roles/                    # Role + user management (admin only)
│   ├── settings/                 # System settings (admin only)
│   ├── shipping/
│   ├── sign-up-login-screen/     # Login (public; wrapped in <Suspense>)
│   ├── track/[orderId]/          # Customer tracking page (public)
│   ├── users/
│   ├── layout.tsx                # Root layout — RTL, Arabic, providers
│   └── not-found.tsx             # 404 page (Arabic)
│
├── components/                   # Shared layout + UI primitives
│   ├── AppLayout.tsx             # Sidebar wrapper + auth guard (client side)
│   ├── Sidebar.tsx
│   ├── NotificationDropdown.tsx
│   └── ui/                       # AppIcon, AppImage, AppLogo
│
├── contexts/
│   ├── AuthContext.tsx           # Auth state + user role from profiles
│   └── NotificationContext.tsx   # Realtime notification badge
│
├── hooks/
│   └── usePermissions.ts         # Convenience hook combining auth + role helpers
│
├── lib/
│   ├── auth/
│   │   ├── routes.ts             # PUBLIC_ROUTES, AUTH_ROUTES, helpers
│   │   └── storage.ts            # APP_STORAGE_KEYS + clearAppStorage()
│   ├── constants/
│   │   └── roles.ts              # ROLE_IDS + isAdminRole/canEditOrders/etc.
│   ├── permissions/
│   │   └── permissions.ts        # PERMISSION_ROUTE_MAP + DEFAULT_ROLES + helpers
│   ├── supabase/
│   │   ├── client.tsx            # createBrowserClient (anon key, cookie auth)
│   │   └── middleware.ts         # createServerClient for middleware
│   ├── utils/
│   │   ├── device.ts             # getDeviceLabel(userAgent)
│   │   └── format.ts             # currency / date / time formatters
│   └── validators/
│       ├── email.ts
│       └── phone.ts              # isValidEgyptianMobile
│
├── styles/                       # Tailwind / global CSS
└── types/
    └── database.ts               # Hand-written Supabase row types

middleware.ts                     # Server-side auth guard
supabase/migrations/              # Schema + RLS policies
```

### Future: per-feature folders

When a feature grows past ~3 components, prefer to create `src/features/<feature>/` and move its components, hooks, types, and queries together. Keep cross-feature primitives in `src/lib`. Don't migrate everything at once — bias to organising new features this way and pulling old ones over only when they need substantial work.

---

## 4. Auth + permissions model

**Roles** live in `src/lib/constants/roles.ts`:

| ID | Name | Notes |
|----|------|-------|
| `r1` | مدير النظام (System Admin) | Full access |
| `r2` | مشرف النظام (System Supervisor) | Manage users, view reports |
| `r3` | مشرف شحن (Shipping Supervisor) | Orders + shipping + inventory |
| `r4` | مندوب شحن (Shipping Delegate) | Update order status only |
| `r5` | مدير خدمة عملاء (CRM Manager) | Reports + CRM |
| `r6` | خدمة عملاء (CRM Agent) | View orders + CRM only |

**SQL helpers** in `supabase/migrations/20260505_harden_rls_policies.sql` mirror these:
- `public.is_admin()` ↔ `isAdminRole()`
- `public.is_manager_or_above()` ↔ `isManagerOrAbove()`
- `public.can_edit_orders()` ↔ `canEditOrders()`

**Component pattern** — use `usePermissions()`:

```tsx
import { usePermissions } from '@/hooks/usePermissions';

function MyComponent() {
  const perms = usePermissions();
  if (perms.loading) return <Spinner />;
  if (!perms.canDeleteOrders) return null;
  return <DeleteButton />;
}
```

Avoid hand-written role checks like `currentRoleId === 'r1'`. Use `isAdminRole(currentRoleId)` or `usePermissions().isAdmin` so the rules stay in one place.

---

## 5. Build / lint / typecheck

```bash
pnpm typecheck     # tsc --noEmit (must be 0 errors)
pnpm lint          # next lint  (must be 0 errors; warnings ok)
pnpm lint:fix      # auto-fix prettier issues
pnpm build         # next build (production); also runs tsc + lint
```

**Strict checks are ON.** `next.config.mjs` no longer ignores type or lint errors. If you introduce one, the build fails on purpose — fix the source, don't re-add `ignoreBuildErrors`.

---

## 6. Deploy

PM2 on a VPS, behind nginx. Fully driven by env vars:

```bash
# On your machine, with VPS_IP, VPS_USER, VPS_PATH, APP_PORT exported:
./deploy_vps.sh
```

The script:
1. rsyncs source (excludes `.env`, `.next`, `node_modules`, `.git`).
2. SSHes to the VPS, runs `corepack pnpm install --frozen-lockfile && pnpm build`.
3. Restarts the PM2 process on `$APP_PORT`.

`finalize_deploy.sh` is for the upload-zip flow and reads `$APP_PATH`.

**Never commit `.env`.** It's in `.gitignore`. Keep VPS env vars in your shell or a CI secret store.

---

## 7. Supabase migrations

All migrations live in `supabase/migrations/`. They are NOT auto-applied. Apply them via the Supabase SQL Editor (or `supabase db push` if the CLI is available) IN ORDER:

```
20260327160000_order_audit_logs.sql
20260327180000_orders_table.sql
20260402_init_schema.sql
20260402180000_crm_fixes.sql
20260505_harden_rls_policies.sql        # role helpers + scoped RLS
20260505b_strengthen_rls_policies.sql   # add UUID columns + role-scoped policies
20260505c_fix_public_rls_exposure.sql   # remove TO public on internal tables
```

**Test on a Supabase preview branch first.** The 20260505* set rolls the schema toward stricter RLS — see TODOs inside each migration for known follow-ups (tracking flow, delegate-initiated notifications).

---

## 8. Adding a new feature

1. **Decide where it lives.** Single new page → drop into `src/app/<route>/page.tsx`. Multi-component feature → consider a `src/features/<name>/` folder.
2. **Add types** for any new tables to `src/types/database.ts` (or generate them — see below).
3. **Add the SQL migration** in `supabase/migrations/YYYYMMDD_description.sql`. Always include RLS policies. Never `USING (true)`.
4. **Add role gating** via `usePermissions()` and/or the SQL helpers — don't reinvent the role check.
5. **Test locally** with `pnpm dev`, then `pnpm typecheck && pnpm lint && pnpm build`.
6. **Open a PR.** Include the migration file in the same PR. Note any required env vars or manual Supabase steps in the PR body.

### Generated Supabase types (recommended)

Right now `src/types/database.ts` is hand-written. To replace with generated types:

```bash
pnpm dlx supabase gen types typescript --project-id <id> > src/types/supabase.ts
```

Then update imports across `src/` to use the generated types.

---

## 9. Security rules (don't break these)

- **Never commit secrets.** `.env`, `*.pem`, `*.key`, `*.crt` are blocked by `.gitignore`. Use `.env.example` to document required keys.
- **Never use `SUPABASE_SERVICE_ROLE_KEY` in client or middleware code.** Server-only (API routes / RPCs).
- **Never write a SQL policy with `USING (true)` or `WITH CHECK (true)`** unless it's intentionally `TO authenticated` and SELECT-only on a non-sensitive lookup table. All other writes must scope to `auth.uid()` or a role helper.
- **Never bypass RLS from the client by adding ad-hoc admin checks.** The DB is the boundary. UI gating is defence in depth.
- **Never use `localStorage.clear()` on signOut** — only the keys in `APP_STORAGE_KEYS`.
- **Tracking page (`/track/[orderId]`) is public.** It needs a server-side RPC or API route with a token guard before it can read orders again under the new RLS. Don't paper over the gap by relaxing RLS.

---

## 10. Where to ask

- Architectural questions → re-read this file + `src/lib/permissions/permissions.ts` and `src/lib/constants/roles.ts`.
- RLS questions → re-read `supabase/migrations/20260505*.sql`. Each policy has an inline comment explaining intent.
- Auth flow questions → `src/contexts/AuthContext.tsx` + `middleware.ts` + `src/lib/auth/routes.ts`.
