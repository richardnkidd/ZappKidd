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

**Run the production build on an always-on home computer and reach it over a private Tailscale network.**

- Why: two people, a few hundred records, SQLite file. A private network means the app is never on the public
  internet, which removes most attack surface; both phones join the household network; HTTPS certificates come from
  `tailscale serve`. No new paid service is required for two users at the time of writing (verify current terms).
- Trade-off: the host must stay on. After the move, either take the host to Tokyo or move to a small VPS (same steps).

Steps (each needs approval where marked):

1. *(approval: new account / device enrollment)* Install Tailscale on the host and both phones; enable MagicDNS.
2. Build: `npm ci && npm run build`.
3. Create the production database from the reviewed import:
   `KADODE_MODE=production KADODE_DB=/path/kadode.db npm run import -- --source "<path to source package>"`.
   *(approval: production data migration)*
4. Create real logins: `KADODE_DB=/path/kadode.db npm run user:password -- --username <name>` for each adult (do not
   reuse other passwords). Dev identities are refused in production by design.
5. Start: `KADODE_MODE=production KADODE_COOKIE_SECURE=true KADODE_DB=/path/kadode.db npm start`
   (binds to 127.0.0.1), then `tailscale serve --https=443 http://127.0.0.1:8787`.
   *(approval: sharing — invite the second adult's device)*
6. Backups: `npm run backup` writes a verified SQLite copy to the data directory. Copy backups to a **restricted**
   folder (e.g. personal Drive "Tokyo Move / Backups", not shared publicly). A scheduled backup is a separate
   approval (it is an automation).

Alternatives considered:

| Option | Pros | Cons |
|---|---|---|
| Cloudflare Tunnel + Access | Free tier, identity gate in front of the app | Public hostname; another account; more configuration |
| Managed host (Fly.io/Render) + volume | Always on, no home hardware | Paid; public internet exposure; more ops |
| Google Sheet as master | Familiar | No per-traveler gates, version conflicts, audit or one-owner rule; competes with the app |

## Task-Management integration (later, separate approval)

Kadode never edits the task store's files. To enable live writes, a sanctioned Task-Management script or API must
expose create / update / complete / read-by-id with a revision number. Then configure the `script` adapter and set
`KADODE_TASK_LIVE_WRITES=approved`. Until then, existing tasks show as a dated read-only copy and new proposals stay
**Pending task capture**.

## Before calling anything "live"

- [ ] Passwords set for both adults; dev identities disabled; `Secure` cookies on.
- [ ] Reached only over the private network (or an identity-gated tunnel).
- [ ] Backup + restore drill performed on the production host.
- [ ] Real-data import receipt reviewed by both adults.
- [ ] Security review re-run against the deployed configuration.
