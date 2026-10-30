# Production path — what it takes to use Kadode from two phones

Today Kadode is a **local preview**. Nothing is deployed, shared, synchronized or connected to a live task store.
Every step below that touches an account, a network service or real-data migration needs the household's explicit
approval first.

## Environments

| Environment | Where | Data | Identity | Status |
|---|---|---|---|---|
| Local demo | Any computer, `127.0.0.1` | Fictional demo household | Development identities | Working |
| Local preview | The planner's Mac, `127.0.0.1` | Imported real plan (private folder) | Development identities (flag) | Working |
| Tested staging | Private host, copy of data | Real-data copy | Passwords | Not set up |
| Live production | Private host | Live household data | Passwords (+ network gate) | Not set up |

## Recommended hosting: private network, no public exposure

**Run the production build on a small always-on cloud server that has no public ports, and reach it only over a
private Tailscale network.**

- Why: two people, a few hundred records, SQLite file. A private network means the app is never on the public
  internet, which removes most attack surface; each adult's devices join with their own identity-provider sign-in
  (with its own two-step verification), and Kadode's own password is the third lock. HTTPS certificates come from
  `tailscale serve`. Tailscale's free Personal plan covers this household (non-commercial use; verify current terms
  at sign-up).
- Why a cloud server rather than a home computer: the household will be split between two cities for months. A home
  host has to be packed, shipped and re-networked exactly when the plan matters most, and is down whenever it sleeps
  or loses power. A small server (a few dollars a month; a new paid service, so it needs approval) keeps the same
  address from either city. Kadode stores links, not uploaded documents, and the plan avoids passport numbers, medical
  originals and full statements, which limits what the hosting provider could ever hold.
- Alternative host: an always-on home computer (free if one exists; same steps), moved to a cloud server before the
  first departure.

Steps (each needs approval where marked):

1. *(approval: new account / device enrollment)* Install Tailscale on the host and both phones; enable MagicDNS.
2. Build: `npm ci && npm run build`.
3. Create the production database from the reviewed import:
   `KADODE_MODE=production KADODE_DB=/path/kadode.db npm run import -- --source "<path to source package>"`.
   *(approval: production data migration)*
4. Create real logins: `KADODE_DB=/path/kadode.db npm run user:password -- --username <name>` for each adult (do not
   reuse other passwords). Dev identities are refused in production by design.
5. Start: `KADODE_MODE=production KADODE_COOKIE_SECURE=true KADODE_PUBLIC_ORIGIN=https://<host>.<tailnet>.ts.net KADODE_DB=/path/kadode.db npm start`
   (binds to 127.0.0.1), then `tailscale serve --https=443 http://127.0.0.1:8787`.
   `KADODE_PUBLIC_ORIGIN` must be the exact https address the phones use: the server answers **421** to any other
   `Host` (DNS-rebinding protection) and only accepts mutations whose `Origin` matches it. Forwarded headers are
   trusted only from a loopback peer.
   *(approval: sharing — invite the second adult's device)*
6. Backups: `npm run backup` writes a verified SQLite copy (file mode 0600) to the data directory; it refuses to run
   against a missing or empty database. A restore signs everyone out. A plain `RESTORE` keeps the current logins and
   is refused if the backup's logins differ; `RESTORE-INCLUDING-USERS` replaces logins on purpose. Copy backups to a **restricted**
   folder (e.g. personal Drive "Tokyo Move / Backups", not shared publicly). A scheduled backup is a separate
   approval (it is an automation).

Alternatives considered:

| Option | Pros | Cons |
|---|---|---|
| Cloudflare Tunnel + Access | Nothing to install on phones (email one-time code or Google sign-in at a web gate); free tier for small teams | Public hostname (discoverable; one wrong rule exposes the sign-in page); Cloudflare decrypts traffic at its edge; needs a domain on Cloudflare |
| Managed host (Fly.io/Render) + volume, public | Always on, simplest to reach | Public internet exposure with only the app password in front; paid |
| The planner's laptop + Tailscale | Free, nothing new | The other adult loses access whenever the lid is closed or it is travelling |
| Google Sheet as master | Familiar | No per-traveler gates, version conflicts, audit or one-owner rule; competes with the app |

## Task-Management integration (later, separate approval)

Kadode never edits the task store's files. To enable live writes, a sanctioned Task-Management script or API must
expose create / update / complete / read-by-id with a revision number. Then configure the `script` adapter and set
`KADODE_TASK_LIVE_WRITES=approved`. Until then, existing tasks show as a dated read-only copy and new proposals stay
**Pending task capture**.

## Safe ways to run the real-data preview today

- **This computer only (default):** `KADODE_MODE=local KADODE_DEV_IDENTITIES=1 npm run dev` — loopback only; the
  server refuses foreign `Host` headers, and the dev server never serves `private/`.
- **From a phone on the same Wi-Fi:** use passwords, not development identities. Set passwords with
  `npm run user:password`, then `KADODE_MODE=local KADODE_LAN=1 npm run dev`. The app refuses `KADODE_LAN=1` together
  with development identities over real data. This is plain HTTP on your home network: use it only on a trusted
  home Wi-Fi (never café or hotel networks) and stop it when you're done; the private-network setup above is the
  long-term answer.
- Never point `KADODE_DB` at a real database without an explicit `KADODE_MODE` (the server refuses).

## Before calling anything "live"

- [ ] Passwords set for both adults; dev identities disabled; `Secure` cookies on.
- [ ] Reached only over the private network (or an identity-gated tunnel).
- [ ] Backup + restore drill performed on the production host.
- [ ] Real-data import receipt reviewed by both adults.
- [ ] Security review re-run against the deployed configuration.
