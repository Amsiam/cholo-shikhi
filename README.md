# Cholo Shikhi (চলো শিখি)

A bilingual (Bangla and English) learning platform for Bangladeshi students preparing for school,
university-admission and job exams, such as the BCS. Students choose a Goal, study video, reading
and quiz lessons, practise from a shared question bank, sit mock exams, play quiz battles and join
live classes. Instructors build and teach courses and are paid a share of what their sections earn.
Admins and Finance staff run the catalog, the money and the trust-and-safety work.

It is built mobile-first for slow networks and low-end Android phones. Every screen works in Bangla
or English (one language at a time, switchable). Personal data stays on Bangladesh-hosted
infrastructure.

- **Stack:** TanStack Start (React, file routes, server functions), TanStack Form and Table,
  shadcn/ui, Zod, Better Auth, Drizzle ORM on PostgreSQL 17, Valkey 8, Vitest with fast-check,
  Playwright, Biome. TypeScript strict, pnpm.
- **Money:** always integer poisha (1 taka = 100 poisha) through one shared `Money` type. Every sale,
  refund and payout is posted to a double-entry ledger that must balance.

---

## Features

### For Students

| Area | What it does | Where |
|---|---|---|
| **Accounts** | Sign-up with email verification, sign-in, password reset, profile with a mobile number, Bangla or English interface | `/sign-up`, `/sign-in`, `/me` |
| **Goals** | Choose an exam Goal (for example BCS Preliminary or HSC Science); the catalog, practice and battles follow it | `/goals`, `/me/goal` |
| **Catalog and course pages** | Browse courses for the Goal, with instructors, outline, price and access period | `/catalog`, `/courses/:id` |
| **Free trial** | One trial per Goal segment of the segment's trial course; opens the first lessons for a set number of days (Admins set the caps per segment) | course page |
| **Buying** | Checkout through the payment gateway (a fake gateway locally), receipts, renewal in the last 14 days, refund requests within the refund window | `/checkout`, `/me/purchases` |
| **Bundles and referrals** | Buy a bundle of courses at a saving; share a referral link and withdraw referral earnings after KYC | `/bundles/:id`, `/me/refer` |
| **Promo codes and campaigns** | Enter a promo code on the course page for a discount; see campaign banners on the home page | course page, `/` |
| **Course switch** | Ask to switch a paid course for another after reading the refund policy; an Admin decides within 24 hours | course page |
| **Subscriptions and packs** | Monthly plans and Practice Packs that open groups of courses | `/store` |
| **Learning** | Video (YouTube, privacy mode), reading and quiz lessons, progress and a resume point | `/learn/:courseId` |
| **Practice** | Topic practice from the question bank, adapting to the Student's level; past-paper questions carry a "From past papers" label | `/practice` |
| **Mistake Vault** | Wrong answers collect in the Vault and come back until mastered (two correct in a row) | `/vault` |
| **Mock exams** | Timed exam packages with negative marking, results and per-topic breakdowns | `/exams`, `/me/results` |
| **Quiz battles** | Real-time head-to-head quiz battles with battle tokens | `/battles` |
| **Live classes** | Scheduled live classes (YouTube Live) with attendance | `/live` |
| **Streaks and rewards** | Daily streaks, streak tokens and shields that protect a streak | `/me/streak` |
| **Study buddies** | Pair with a buddy and see each other's weekly progress | `/me/buddy` |
| **Notifications** | In-app and email notifications with per-type preferences | `/notifications` |

### For Instructors

| Area | What it does | Where |
|---|---|---|
| **Course authoring** | Courses, sections and lessons (video, reading, quiz) with drafts, review and publishing; co-teaching through section ownership | `/instructor/courses` |
| **Question bank** | Write questions in both languages, send them for review, see measured difficulty | `/bank`, `/questions` |
| **Exam builder** | Build mock exam packages from the bank | `/exam-builder` |
| **Live and battles** | Host live classes and quiz battles | `/live-host`, `/battle-host` |
| **Teaching dashboard** | Students, completion, course NPS, bonus quizzes, per-student live attendance | `/instructor` |
| **Earnings** | Monthly earnings from the ledger, stored statements kept for at least 10 years | `/instructor/earnings`, `/instructor/statements` |
| **Payouts** | KYC, payout account registration (bKash, Nagad, bank), per-cycle payout statements, held payouts | `/instructor/payouts`, `/instructor/cycles` |

### For Admins (two-step sign-in required)

| Area | What it does | Where |
|---|---|---|
| **Console** | Feature flags, versioned settings, the audit log, free-trial courses and caps per segment | `/admin` |
| **Staff and roles** | Give or take away the Instructor (employee or contractor), Admin and Finance roles; never the last Admin | `/admin/staff` |
| **Goals and topics** | Segments, Goals and the question taxonomy (subjects, topics, sub-topics) | `/admin/goals`, `/admin/topics` |
| **Catalog** | Plans, exam packages, blocked link domains | `/admin/plans`, `/admin/exam-packages`, `/admin/blocked-domains` |
| **Past-paper import** | Import rights-cleared or public-domain past-paper questions from a CSV, with a per-row report; repeat imports add no duplicates | `/admin/past-papers` |
| **Copyright takedowns** | Log a notice against a course, section or lesson, then honour it (the content is hidden), reject it, or reverse it, always with a reason | `/admin/takedowns` |
| **Refunds and switches** | Decide refund requests and course switch requests (full or unused-days refund) | `/admin/refunds`, `/admin/switches` |
| **Rewards** | Streak token and shield rules | `/admin/rewards` |
| **KYC review** | Approve or reject instructors' identity documents | `/admin/kyc` |
| **Referrals** | Referral share and minimum payout, withdrawal approvals | `/admin/referrals` |
| **Marketing** | Campaigns (home-page banners by segment and date), promo codes with use limits (applied at checkout), bundles listed in the catalog | `/admin/marketing` |
| **Attribution disputes** | Open a case when a section's owner is contested, resolve it with the confirmed owner and a reason; payout dry runs flag affected instructors | `/admin/attribution` |
| **Fraud review** | Manually flag suspicious Vault answers, battle or live-quiz collusion and referral abuse with a reason, then clear or ban; an open flag holds the effect back | `/admin/fraud` |

Every Admin decision is written to the audit log with who, when and why.

### For Finance

| Area | What it does | Where |
|---|---|---|
| **Platform books** | Sales, refunds, instructor shares and platform revenue from the ledger | `/admin/finance` |
| **Payment disputes** | Record a gateway dispute; an evidence pack (payment, enrolment, lesson access, quiz scores) is generated, locked with a hash, and exported as CSV | `/admin/disputes` |
| **HR records** | Pay-policy versions (effective from the next cycle), employee salary, joining and exit dates, leave and absence | `/admin/hr` |
| **Payout cycles** | Monthly payout cycles (Dhaka calendar month): draft, check against the human-approved golden examples, commit, export; KYC review | `/admin/payouts`, `/admin/kyc` |

### Platform

- **Identity:** Better Auth with secure cookies, rate limits, and mandatory two-step sign-in (TOTP) for
  staff. Every server function checks the session and role and denies by default.
- **Audit, flags and settings:** an append-only audit log, feature flags for dark launches, and versioned
  settings (global or per Goal segment) where every change records the old and new value.
- **Jobs and outbox:** a worker process runs a transactional outbox relay and recurring jobs, such as
  switch-request expiry, health probes and retention.
- **Ledger:** double-entry postings for sales, refunds and payouts, enforced by database checks. Payout
  maths is checked against golden examples that only the human may change.
- **Real-time:** WebSocket rooms for battles and live classes (`dev:realtime`).
- **i18n and accessibility:** every string in `bn` and `en` (checked by `pnpm i18n:check`), WCAG 2.1 AA
  targets, and states shown with text and icons, never by colour alone.

---

## Run it from scratch

This walks through everything from a fresh machine to the running app with demo data. It takes
about 15 minutes. Commands are for Linux or macOS; on Windows use WSL 2.

### 1. Install the tools (once per machine)

| Tool | Version | How to install | Check |
|---|---|---|---|
| **Git** | any recent | your package manager | `git --version` |
| **Node.js** | 24 (the repo pins 24.22.3) | [nvm](https://github.com/nvm-sh/nvm), then `nvm install 24.22.3` | `node --version` |
| **pnpm** | 10.18 | `corepack enable pnpm` (Corepack ships with Node) | `pnpm --version` |
| **Docker** with Compose | Docker 24+ | Docker Desktop, or Docker Engine plus the compose plugin | `docker compose version` |

Docker runs PostgreSQL 17 and Valkey 8 for you; you do not install them yourself. Make sure the
Docker daemon is running before step 4.

### 2. Get the code and open the project folder

```bash
git clone <repository-url> cholo-shikhi
cd cholo-shikhi                   # every command below runs from this folder
nvm use                           # switches to the Node version in .nvmrc
```


### 3. Install dependencies and create your local settings

```bash
pnpm install --frozen-lockfile    # exact versions from the committed lockfile
pnpm env:init                     # writes .env with freshly generated local secrets
```

`.env` is never committed. `pnpm env:init` sets `NODE_ENV=development`, the database and Valkey
addresses, and generates every secret. Running it again never changes your existing lines; it only
appends secrets that newer versions of the app need and your `.env` lacks.

### 4. Start the database and Valkey

```bash
pnpm db:up                        # PostgreSQL on 127.0.0.1:55432, Valkey on 127.0.0.1:56379
pnpm db:migrate                   # creates every table (forward-only migrations in ./drizzle)
```

`pnpm db:up` waits until both containers are healthy. Their data lives in Docker volumes, so it
survives restarts.

### 5. Load the demo data

Run these four in order. Each is safe to run again; it only adds what is missing.

```bash
pnpm db:seed-demo                 # exam Goals, bilingual courses with lessons, the demo Student and Instructor
pnpm db:seed-activity             # synthetic learners, purchases and progress; posts sales to the ledger
pnpm db:seed-bank                 # question taxonomy and published practice questions
pnpm db:seed-staff                # demo Admin and Finance, Admin settings, sample admin work items
```

The seeds refuse to run unless `NODE_ENV=development` and the database is on your own machine.
All demo data is synthetic and uses reserved `example.test` addresses.

### 6. Start the app (three terminals)

The app is three processes. Open three terminals in the project folder:

```bash
pnpm dev              # terminal 1: the web app on http://localhost:3000
pnpm dev:worker       # terminal 2: background jobs, outbox relay and notification delivery
pnpm dev:realtime     # terminal 3: live classes and quiz battles on ws://localhost:3001
```

Check it is healthy: open **http://localhost:3000/api/health/ready**. It should show
`"database":"up","valkey":"up","relay":"up"`. If `relay` says `lagging`, the worker (terminal 2) is
not running.

### 7. Sign in

Open **http://localhost:3000** and sign in with one of the demo accounts:

| Role | Email | Password |
|---|---|---|
| Student | `student@example.test` | `DemoStudent2026!` |
| Instructor | `demo.instructor2@example.test` | `DemoTeacher2026!` |
| Admin | `demo.admin@example.test` | `DemoAdmin2026!` |
| Finance | `demo.finance@example.test` | `DemoFinance2026!` |

- **Student:** goes straight to the home page with three purchased courses, progress and results.
- **Staff (Instructor, Admin, Finance):** the first sign-in asks you to set up two-step sign-in.
  Scan the QR code (or type the setup key) into any authenticator app, such as Google
  Authenticator, Microsoft Authenticator or 1Password. Enter the 6-digit code, then save the
  recovery codes. Later sign-ins ask for a fresh code from the app.
- **Admin pages** are listed in the menu under Admin, starting at http://localhost:3000/admin.

### 8. Try the main flows

| Try this | As | Where |
|---|---|---|
| Browse courses, buy one with the fake gateway, then study it | Student | `/catalog` → a course → Buy |
| Practise questions and review mistakes | Student | `/practice`, `/vault` |
| Ask to switch a course or for a refund | Student | a course page, `/me/purchases` |
| Build a course and send it for review | Instructor | `/instructor/courses` |
| Decide the seeded switch request and takedown notice | Admin | `/admin/switches`, `/admin/takedowns` |
| Import past-paper questions from a CSV | Admin | `/admin/past-papers` |
| See the platform books and run a payout cycle | Finance | `/admin/finance`, `/admin/payouts` |

- **Emails** (sign-up verification, password reset, notifications) are not sent. They appear at
  **http://localhost:3000/dev/mailbox**.
- **Payments** use a test gateway: the checkout page offers **Pay** or **Decline payment**. No real
  money moves, and no real payment or payout service is ever called.
- **New accounts:** sign up at `/sign-up`, then open the verification link from the dev mailbox.

### 9. Stop and restart

- **Stop the app:** press `Ctrl+C` in each of the three terminals.
- **Stop the database:** `pnpm db:down`. Your data is kept.
- **Start again later:** `pnpm db:up`, then `pnpm db:migrate` (in case new migrations arrived),
  then the three processes from step 6.
- **Start over with an empty database:** run
  `docker compose --env-file .env -f docker-compose.dev.yml down -v`, which **deletes all local
  data**, then repeat steps 4 and 5.

### Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm: command not found` | Run `corepack enable pnpm`, then open a new terminal. |
| `Unsupported engine` or odd syntax errors | Run `nvm use` in the project folder; Node must be 24. |
| `pnpm db:up` fails or hangs | Start Docker. If ports 55432 or 56379 are taken, stop whatever uses them. |
| `Port 3000 is in use` | Stop the other process (`lsof -i :3000`), or the old `pnpm dev`. |
| Start-up error about `CATALOG_CURSOR_KEYS` or another variable | Run `pnpm env:init` again; it adds newly required secrets. |
| A page says a setting is not set | Run `pnpm db:seed-staff`, or set it on `/admin` as the Admin. |
| Sign-up says "too many attempts" | Local rate limits; wait 15 minutes. |
| `out of shared memory` in tests | Restart the database with `pnpm db:down && pnpm db:up`. |
| A two-step code is refused | Check your phone's clock is set automatically; codes last 30 seconds. |

### Without the demo data

On an empty database, create the first Admin yourself: sign up and verify an account, then run
`pnpm identity:bootstrap-admin <email>` and sign in again to set up two-step. Then, as that Admin,
set the course price limits and the refund window on `/admin`; checkout and pricing refuse until
they are set.

### Production build

`pnpm build && pnpm start` builds and serves the app from `dist/` on port 3000. Production also
needs the worker and real-time processes, real secrets in a secret store, and Bangladesh-hosted
infrastructure for personal data.

## Tests and checks

```bash
pnpm test                 # unit + integration (real PostgreSQL/Valkey; run `pnpm db:up` first) + components
pnpm test:coverage        # v8 coverage: >= 80% lines overall, 100% on money modules
pnpm lint                 # Biome: format, lint, accessibility rules, import boundaries
pnpm typecheck            # tsc --noEmit (strict, noUncheckedIndexedAccess)
pnpm i18n:check           # bn/en catalogue parity and no literal JSX strings
pnpm e2e                  # Playwright journeys (needs `pnpm exec playwright install chromium`)
pnpm exec playwright test e2e/smoke/all-routes.spec.ts   # every page as every role (app running, demo data seeded)
pnpm verify               # typecheck + Biome + i18n check + tests with coverage + build + smoke
```

> **Current status:** all tests pass, but overall line coverage is about 74%, below the 80% floor,
> so `pnpm test:coverage` and `pnpm verify` currently fail. The gap is in screen components and
> route files; the money logic is at 100%. `pnpm test`, `pnpm lint`, `pnpm typecheck` and
> `pnpm build` all pass.

Integration tests create a fresh PostgreSQL schema per test file, apply the migrations, and drop it
afterwards; they are never skipped. Money logic (pricing, refunds, switches, payouts) is tested
first, with unit and property-based tests. Every server function has an authorization test for
anonymous callers, the wrong user and the wrong role
(`src/server/server-functions.authz.int.test.ts`). `E2E_THROTTLE=1 pnpm e2e` adds 3G and 4x CPU
throttling.

## Project layout

```
src/
  routes/                 thin file routes (TanStack Router); admin pages are admin_.<name>.tsx
  features/<feature>/     domain/ (plain TS rules) · data/ (repositories) · server/ (services,
                          server functions, schemas) · ui/ (components) · index.ts (public surface)
  components/ui/          shadcn/ui components
  lib/                    shared kernel: money, result, errors, time, env, logger, csv, i18n/
  server/                 DB client and schema, Better Auth, server-function builders, headers
  worker/                 outbox relay and job scheduler
drizzle/                  forward-only SQL migrations
scripts/                  env setup, migrations, demo seeds, admin bootstrap, smoke test
e2e/                      Playwright journeys
```

Features: `identity-access`, `platform`, `notifications`, `app-shell`, `dashboard`, `goals`,
`catalog`, `commerce`, `learning`, `assessment`, `battle`, `live`, `realtime`, `insights`, `ledger`,
`payouts`, `kyc`, `trustops`, `marketing`, `hr`. Layers run route → server function → domain → data. Domain code imports
no framework, database or environment. Cross-feature imports go only through a feature's `index.ts`.

## Configuration

Every environment reads its settings once through `src/lib/env.ts`; `.env.example` lists the variable
names, and values are never committed. Locally `pnpm env:init` fills `.env`.

- **`CATALOG_CURSOR_KEYS`** (required secret): `<kid>:<base64 32 bytes>[,<previous kid>:<base64 32 bytes>]`,
  the catalog paging-cursor HMAC keys. A missing or malformed value stops start-up.
- **`IMAGE_HELPER_SOCKET_PATH`** (optional): the image-helper socket, default `/run/helper/helper.sock`.
  Image uploads are behind the `catalog.imageUploads` flag and fail closed outside the hardened sidecar.
- **Admin settings without defaults** (a read answers `SETTING_NOT_SET` until saved on `/admin`):
  course, exam-package and plan price bounds, and the refund window.
- **Security headers:** a per-request CSP nonce, and frames limited to `youtube-nocookie.com`.

### Adding a module

Notification types are registered in `src/features/notifications/server/notifications-instance.server.ts`,
settings in `src/features/platform/server/settings-instance.server.ts`, and recurring jobs in
`src/worker/job-handlers.ts`.

## Not built yet (deferred by the product owner)

- CI/CD pipelines and their gates, production Dockerfiles and IaC, the observability stack and paging.
  `pnpm verify` is the local stand-in.
- PDF rendering (returns `RENDERER_UNAVAILABLE` until a headless-Chromium package is approved), so
  dispute evidence packs export as CSV or through the browser's print to PDF.
- Automatic fraud, collusion and Vault-poisoning detectors: only manual review queues exist for now.
- Payroll, hybrid pay and attribution money are built and their 17 golden examples are approved
  (`src/features/payouts/domain/golden/drafts/`); they take effect when an Admin turns on the
  `payouts.payrollAndAttribution` flag.
- Real payment and disbursement gateways (bKash, Nagad, SSLCommerz, bank): stubs only.
