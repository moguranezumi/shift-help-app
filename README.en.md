# Shift Help App

A self-hostable web app for restaurant chains to request and coordinate
shift help (cover shifts) between stores. Built as a single HTML file on top
of Supabase (Auth + Postgres + Edge Functions + Realtime), with Web Push
notifications and a static front-end you can host anywhere.

- **Three roles:** headquarters (HQ), store managers, and employees.
- **Core flow:** a store or employee posts a help request; eligible
  employees from nearby / in-area / wider stores can apply for all or part
  of the time slot.
- **Extras:** proxy rights between stores, per-store apply-scope limits,
  minimum apply duration, audit logging, forced initial password change,
  and PWA push notifications.

> This is a community/OSS release. It ships with **no data and no secrets**.
> You bring your own Supabase / hosting / push keys. See setup below.

## License

MIT. See [LICENSE](./LICENSE). Provided "as is", without warranty. You are
responsible for your own deployment, data, and compliance.

> 日本語版: [README.md](./README.md)

---

## Architecture at a glance

| Piece            | What it is                                              |
|------------------|---------------------------------------------------------|
| `index.html`     | The entire front-end (HTML + CSS + JS in one file).     |
| Supabase Auth    | Login for HQ, stores, employees (virtual email/pass).   |
| Supabase Postgres| Tables + Row Level Security + triggers (`schema.sql`).  |
| Edge Functions   | Privileged operations (create/delete users, etc.).      |
| Realtime         | Live updates of requests across clients.                |
| Web Push (VAPID) | Notifications via a service worker.                     |
| GitHub Actions   | Daily keep-alive ping + old-request cleanup.            |

Logins use **virtual email addresses** (never real inboxes):
`hq@shift.local`, `<CODE>@store.shift.local`, `<CODE>@emp.shift.local`.

---

## Prerequisites

- A [Supabase](https://supabase.com) account (free plan is fine to start).
- A static host for `index.html` (Cloudflare Pages, Netlify, Vercel, GitHub
  Pages, or even Supabase Storage). **HTTPS is required** for service workers
  and push.
- Node.js (only to generate VAPID keys via `npx`).
- Optional: a GitHub repo if you want the daily keep-alive / cleanup job.

---

## Setup

### 1. Create the database

1. Create a new Supabase project (pick a region close to your users).
2. Open **SQL Editor**, paste the entire contents of
   [`supabase/schema.sql`](./supabase/schema.sql), and run it.
   This creates all tables, indexes, RLS policies, and triggers.

### 2. Generate VAPID keys (for push notifications)

```bash
npx web-push generate-vapid-keys
```

Keep both the **public** and **private** keys. The public key goes into
`index.html`; both go into the Edge Function secrets.

### 3. Deploy the Edge Functions

Each folder under `supabase/functions/` is one function. Deploy them with the
[Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy create-store create-employee admin-update-password \
  delete-user update-store update-employee revoke-proxy send-notification \
  hq-recover cleanup-old-requests
```

> **⚠️ If deployment fails:**
> - **Working directory:** Run `deploy` from the directory that *contains*
>   the `supabase/` folder (the repo root, i.e. inside `shift-help-app/`).
>   Running it elsewhere causes `Entrypoint path does not exist` or
>   `cannot find the path` errors. Confirm with `ls supabase/functions`
>   (`dir supabase\functions` on Windows) before deploying.
> - **Docker:** By default the CLI builds with Docker, so you may see a
>   `Docker is not running` warning. To deploy without Docker, append
>   `--use-api` to the command. (Or start Docker Desktop first.)

**Deploying manually from the dashboard** (no Docker, no CLI):

1. Dashboard → **Edge Functions** → **Create a new function**.
2. Enter the function name (e.g. `create-store`).
3. Paste the contents of `supabase/functions/create-store/index.ts`.
4. Deploy.
5. Repeat for all 10 functions.

### 4. Set Edge Function secrets

In **Project Settings → Edge Functions → Secrets** (or via
`supabase secrets set KEY=value`), set:

| Secret                      | Value / notes                                            |
|-----------------------------|----------------------------------------------------------|
| `SUPABASE_URL`              | usually auto-provided                                    |
| `SUPABASE_ANON_KEY`         | usually auto-provided                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | usually auto-provided                                    |
| `VAPID_SUBJECT`             | `mailto:you@example.com`                                 |
| `VAPID_PUBLIC_KEY`          | from step 2                                              |
| `VAPID_PRIVATE_KEY`         | from step 2                                              |
| `CRON_SECRET`               | any long random string (used by the cleanup job)         |
| `HQ_HIDDEN_CODE`            | your own emergency HQ code, e.g. `7421-9930-5582`        |
| `HQ_DEFAULT_RECOVERY`       | recovery code restored after the hidden code is used     |

> **Important:** `HQ_HIDDEN_CODE` is an emergency master code that resets the
> HQ password without login. Choose a long, unique value and keep it secret.
> Never reuse the example values.

### 5. Configure the front-end

Edit the top of the `<script>` section in `index.html`:

```js
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // https://xxxx.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // Settings > API > anon public
const VAPID_PUBLIC_KEY  = 'YOUR_VAPID_PUBLIC_KEY';   // public key from step 2
```

### 6. Create the HQ (headquarters) account

The HQ account is the single admin. Create it once:

1. In Supabase **Authentication → Users → Add user**, create a user with
   email `hq@shift.local` and a password you choose. Confirm the email.
2. Copy that user's UUID.
3. In **SQL Editor**, link it to the `hq` row and set a recovery code:

   ```sql
   insert into public.hq (id, auth_id, code, recovery)
   values (1, '<HQ_USER_UUID>', 'Admin', 'ABCD-EFGH-JKLM')
   on conflict (id) do update
     set auth_id = excluded.auth_id,
         code = excluded.code,
         recovery = excluded.recovery;
   ```

   - `code` is what you type in the HQ login field (default `Admin`,
     case-insensitive).
   - `recovery` is the code shown for password recovery. Use your own.

### 7. Host `index.html`

Upload `index.html` to any HTTPS static host. For full PWA/push behaviour,
host `sw.js` (the service worker) and `manifest.json` alongside it. Open the
URL and log in as HQ.

### 8. (Optional) Daily keep-alive + cleanup

On the free plan, Supabase pauses idle projects. The included workflow pings
the project (to prevent pausing) and deletes requests older than 30 days.

**Important: the automatic daily schedule is disabled by default.** To avoid
failing runs (and failure emails) before setup is complete, the workflow only
runs manually at first (Actions tab > "Run workflow").

1. Put this repo on GitHub.
2. In **Settings → Secrets and variables → Actions**, add:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CRON_SECRET` (same as the Edge
   Function secret).
3. Test it manually from the Actions tab ("Keep Supabase Alive" > "Run
   workflow").
4. To enable the daily automatic run, after setting the secrets, uncomment
   the two `schedule:` lines (remove the leading `#`) in
   `.github/workflows/keepalive.yml`.

### 9. Tighten auth rate limits (recommended)

In **Authentication → Rate Limits**, lower "sign-ups and sign-ins" (e.g. to
~10 per 5 minutes) to slow brute-force attempts.

---

## First run

1. Log in as HQ (`Admin` + your password).
2. Create a store; note the store code and the initial password you set.
3. Log in as that store (you'll be forced to change the initial password).
4. Add employees (they start with a fixed initial password and must change
   it on first login).
5. Configure each store's nearby / in-area / apply-scope and proxy settings.

---

## Security notes

- Privileged actions run only in Edge Functions using the service role key;
  the browser never sees it.
- Row Level Security restricts what each role can read and write. Identity
  columns are further protected by triggers.
- Initial passwords must be changed on first login.
- Audit logs record key actions (login, account changes, password resets,
  proxy changes, etc.) and can be exported to CSV from the HQ screen.
- The Supabase URL and anon key are public by design (the browser uses them);
  RLS is what protects your data. The service role key, VAPID private key,
  `CRON_SECRET`, and `HQ_HIDDEN_CODE` must stay secret.

## Scaling notes

- The free Supabase plan handles small/medium deployments. The first limit
  you're likely to hit is **Realtime concurrent connections** (≈200), counted
  only while the app is open in a browser (push does not count).
- For large deployments (hundreds of stores), move to a paid plan rather than
  splitting across projects (cross-store help needs one shared database).

---

## Disclaimer

This software is provided as-is under the MIT license. You are solely
responsible for deploying it securely, protecting your secrets, backing up
your data, and complying with all applicable laws and regulations in your
jurisdiction.
