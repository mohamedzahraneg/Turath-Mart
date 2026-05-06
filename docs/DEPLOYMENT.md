# Deployment

Deployment is automated via **GitHub Actions** workflows. There is no manual SSH from a developer's terminal in normal operation — that pattern was retired in PR #2 because it leaks credentials into chat / scrollback / shell history and gives the developer machine root reach into production.

This document covers:

1. [Why we don't SSH from chat or developer terminals](#why-no-ssh-from-chat)
2. [One-time setup](#one-time-setup)
3. [Required GitHub Secrets](#required-github-secrets)
4. [Staging deployment](#staging-deployment)
5. [Production cutover](#production-cutover)
6. [Migrations are NOT automated](#migrations-are-not-automated)
7. [Rollback basics](#rollback-basics)
8. [Troubleshooting](#troubleshooting)

---

## Why no SSH from chat

- Credentials shared in a chat session are recorded in transcript, in browser cache, in upstream logs, and in clipboard history. There is no way to "un-leak" them.
- Every shell command run via SSH writes its output back to the chat. That output frequently contains hostnames, paths, environment hints, and process arguments — building a full inventory of the server inside the conversation.
- Allowing one "approved" SSH from chat normalises the pattern; the next time the request comes from a hijacked session or a prompt-injected message, the assistant has no signal to refuse.
- GitHub Actions provides:
  - encrypted-at-rest secrets that never appear in the repo or in PRs;
  - per-environment scoping so staging keys can't be used to touch production;
  - an audit log of every deploy with timestamp, actor, and triggering commit;
  - required-reviewer protection on production;
  - reproducibility — the runner is a clean Ubuntu image every time.

---

## One-time setup

Run these steps **on your local machine**, in a terminal **you trust**. Nothing in this section should be pasted into a chat or PR.

### 1. Generate a dedicated deploy SSH key

Don't reuse your personal SSH key. Generate one specifically for GitHub Actions so you can revoke it independently if it ever leaks.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/turath_deploy -N "" -C "github-actions-deploy"
```

This creates two files:

- `~/.ssh/turath_deploy` — the **private** key. Stays on your machine. Never shared. Never committed.
- `~/.ssh/turath_deploy.pub` — the **public** key. Goes on the VPS.

### 2. Authorise the public key on each VPS

You need the deploy user to exist on the VPS first. Strongly recommended: a non-root user (e.g. `deployer`) with sudo only for the specific commands deployment needs. If you must use root for now, that's documented but should be migrated.

```bash
# Push the public key to the VPS authorized_keys for the deploy user.
ssh-copy-id -i ~/.ssh/turath_deploy.pub <deploy-user>@<vps-host>
```

Verify it works:

```bash
ssh -i ~/.ssh/turath_deploy <deploy-user>@<vps-host> "whoami && hostname"
```

If that prints the user and hostname, you're ready.

### 3. (Strongly recommended) Disable SSH password auth on the VPS

Once key-based auth is verified, lock down password auth so the previously-leaked password is unusable.

```bash
ssh -i ~/.ssh/turath_deploy <deploy-user>@<vps-host>
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl restart sshd
exit
```

Test from a **separate terminal** before closing the original session, in case anything's misconfigured.

### 4. Configure GitHub Environments

In GitHub: repo → **Settings → Environments → New environment**.

- Create `staging` — no required reviewers needed for a fast feedback loop.
- Create `production` — add **Required reviewers** (yourself + at least one other person if available). Optionally add a deployment branch restriction so production can only deploy from `main`.

The workflows reference these environments by name. Without them, the deploy jobs will succeed without the protection layer.

### 5. Add secrets

See [Required GitHub Secrets](#required-github-secrets) below. Each environment gets its own copies — same names, different values per environment.

---

## Required GitHub Secrets

All nine secrets must be set **in each environment** (`staging` and `production`). Set them at: repo → **Settings → Environments → \<env\> → Add environment secret**.

| Secret | Example shape | Notes |
|---|---|---|
| `VPS_HOST` | `staging.example.com` or `203.0.113.10` | Hostname or IP of the target VPS for this environment. |
| `VPS_USER` | `deployer` | The OS user the deploy SSHes as. Should NOT be root if you can avoid it. |
| `VPS_SSH_KEY` | Full content of `~/.ssh/turath_deploy` (the private key, including `-----BEGIN OPENSSH PRIVATE KEY-----` lines) | One value per environment if you want separate keys; otherwise the same key for both is acceptable. |
| `VPS_PATH` | `/www/wwwroot/turath-staging` or `/www/wwwroot/turath-masr` | Absolute path on the VPS where the app is deployed. |
| `APP_PORT` | `875` (staging) / `874` (production) | Port the PM2 process listens on. Must NOT collide with other PM2 apps. |
| `PM2_APP_NAME` | `turath-staging` / `turath-masr` | PM2 process name. Must be unique per environment when running side by side. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | Supabase project / branch URL for this environment. **Use the staging branch URL for staging.** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (long JWT) | Anon key paired with the URL above. |
| `NEXT_PUBLIC_SITE_URL` | `http://203.0.113.10:875` | Public URL the deploy verification step will curl. |

**Never** put secrets in:

- the repo (any file)
- the PR description
- workflow YAML literals
- chat with anyone, including AI assistants
- screenshots

---

## Staging deployment

### Trigger

- Manual: repo → **Actions → "Deploy Staging" → Run workflow**.
- Automatic: any push to `security/hardening-phase-1-2-3` triggers it. Once that branch merges, edit `.github/workflows/deploy-staging.yml` to point at a long-lived `staging` branch (or remove the auto trigger).

### What it does

1. Quality gates: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. If any fails, the deploy job is skipped.
2. Loads the deploy SSH key into `ssh-agent` for the job's lifetime.
3. Adds the staging VPS to `known_hosts`.
4. Creates `$VPS_PATH` on the VPS if missing.
5. Writes `$VPS_PATH/.env` with the staging Supabase URL/key/site URL. Mode `600`.
6. Runs `./deploy_vps.sh` with the staging env vars (`PM2_APP_NAME=turath-staging`, `APP_PORT=875`, etc).
7. Curls `NEXT_PUBLIC_SITE_URL` 6 times with 5-second waits, fails the run if no `2xx`/`3xx` within ~60 seconds.

### Differences from production

- Different `PM2_APP_NAME` so it runs alongside production.
- Different `APP_PORT` (default 875).
- Different `VPS_PATH` (default `/www/wwwroot/turath-staging`).
- Different Supabase project/branch — staging must NEVER point at the production database.

### After staging deploys

Run the manual smoke-test checklist in the repo (see docs/DEVELOPMENT.md → "Manual QA checklist" or the PR #2 description). Until staging passes, do not run the production workflow.

---

## Production cutover

### Hard prerequisites (in order)

1. **Staging deploy succeeded** for the same commit you're about to ship.
2. **Manual QA passed on staging** — login, order create, status update, tracking page, RLS denied for raw orders read.
3. **Supabase production keys rotated.** The previous anon key was leaked; treat it as compromised.
4. **All four RLS migrations applied to production Supabase** via the dashboard SQL Editor, in this exact order:
   1. `supabase/migrations/20260505_harden_rls_policies.sql`
   2. `supabase/migrations/20260505b_strengthen_rls_policies.sql`
   3. `supabase/migrations/20260505c_fix_public_rls_exposure.sql`
   4. `supabase/migrations/20260506_secure_tracking_rpc.sql`
5. **Production environment secrets updated** with the new anon key.

If any of those is missing, abort.

### Trigger

repo → **Actions → "Deploy Production" → Run workflow**.

You will be asked to type two inputs:

- `confirm`: must be exactly `DEPLOY-PRODUCTION` (case-sensitive). Anything else aborts the run.
- `migrations_applied`: must be exactly `yes`. If you didn't apply migrations, type `no` (or anything else) and the run aborts.

### Approval

The `deploy` job is gated by the GitHub `production` environment. After the quality gates pass, GitHub pauses and requests approval from the configured reviewers. Approve in the Actions UI to release the deploy.

### What it does

Same shape as the staging workflow, but reads from the `production` environment secrets. The verification step curls the production URL.

---

## Migrations are NOT automated

The deployment workflows **do not run any SQL migrations**. They never connect to Supabase from the VPS for schema changes, and they never use a service-role key.

Migrations must be applied **manually** via the Supabase Dashboard SQL Editor, **before** running the production deploy workflow. The order matters — applying them out of order will leave the database in an inconsistent state.

For verification queries to run after each migration, see the comments inside each `.sql` file and the staging runbook.

If you're tempted to add a "run migrations" step to a workflow:

- Don't put a service-role key in `secrets.*` for that purpose. The blast radius if it leaks is too large.
- If you absolutely need automated migrations later, use Supabase CLI's `db push` from a workflow that pulls a short-lived deploy token, runs the migration, and revokes the token. That's a separate design — not in this PR.

---

## Rollback basics

### Application rollback

Re-run the workflow against the previous commit:

1. Find the last good commit SHA (the one deployed before the current bad one).
2. Actions → "Deploy Staging" or "Deploy Production" → Run workflow → pick the commit's branch → run.
3. The PM2 restart picks up the older code.

If you need to roll back faster than a full deploy:

```bash
# On the VPS (manual, only when truly needed):
pm2 restart <PM2_APP_NAME>     # restarts current build
# or, for an emergency stop:
pm2 stop <PM2_APP_NAME>
```

### Database rollback

The RLS migrations add columns + triggers + tighter policies. They do **not** drop user data. To undo:

1. Restore the Supabase backup taken just before the cutover (Dashboard → Database → Backups → Restore).
2. Re-run the production deploy workflow to redeploy the application against the rolled-back schema.

### Total rollback (application + database)

1. PM2 stop the staging or prod process if customer-facing.
2. Restore Supabase backup.
3. Redeploy the previous app commit.
4. Verify with the smoke checklist.

---

## Troubleshooting

### `Permission denied (publickey)` on rsync/ssh

- The deploy key isn't in `~/.ssh/authorized_keys` on the VPS for the `VPS_USER` you configured. Re-run `ssh-copy-id`.
- The `VPS_SSH_KEY` secret in GitHub is the public key by mistake. It must be the **private** key, including the `-----BEGIN ... PRIVATE KEY-----` and `-----END ...` lines.

### `Host key verification failed`

- The workflow does `ssh-keyscan` to populate `known_hosts`. If the VPS host key changes (rebuild, reinstall), the action fails. Re-run after confirming the new fingerprint matches what you expect.

### Build passes in CI but fails on the VPS

- Different Node version on the VPS than the runner. The workflow uses Node 22; the VPS uses `/www/server/nodejs/v22.20.0`. Verify they match.
- Out of memory on the VPS. Next.js builds are memory-hungry; you may need a swap file or to bump the VPS RAM.

### Verification curl fails with `000` status

- `NEXT_PUBLIC_SITE_URL` is unreachable from GitHub runners. Could be:
  - Firewall blocking GitHub IP ranges.
  - VPS process didn't actually start (check `pm2 logs <PM2_APP_NAME> --lines 50` directly on the VPS).
  - Wrong port or wrong URL in the secret.

### Staging deploys to production by mistake

- Set `PM2_APP_NAME` correctly per environment. Production should keep `turath-masr`; staging must use a different name (e.g. `turath-staging`).
- Set `VPS_PATH` correctly per environment. Production: `/www/wwwroot/turath-masr` (or wherever it lives now). Staging: `/www/wwwroot/turath-staging`.
- Set `APP_PORT` correctly. Production: `874`. Staging: `875`.

If any of these collide, the staging deploy will overwrite production. Double-check environment secrets.
