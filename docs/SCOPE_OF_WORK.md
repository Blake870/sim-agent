# sim-agent — Scope of Work

> Handoff document. Read this first to understand what sim-agent is, why it exists,
> how it fits with the `sim` server, and what to build. Nothing is implemented yet
> beyond the repo skeleton and the license — this is the design/spec.

---

## 1. What it is

`sim-agent` is a lightweight, **open (source-available)** daemon that runs on a
machine the account owner controls (their PC/VPS) and performs **Steam** actions for
the `sim` platform (sim.gudoguy.com) — logging in, checking inventory, sending trade
offers, confirming them via the mobile authenticator.

It exists so that security-conscious customers **do not have to store their Steam
secrets** (`shared_secret`, `identity_secret`, password) on our servers. The secrets
stay on their machine; the agent is the only thing that touches them.

## 2. The core principle — keep the agent THIN

**The agent is a commodity executor. The `sim` server is the product.**

- The agent holds Steam secrets and executes **primitives only**: `checkInventory`,
  `sendTrade(assets, tradeUrl)`, `confirmMobile`, `login/heartbeat`.
- The agent has **no** business logic: no pricing, no CSFloat integration, no decision
  about *which* trade to send or *why*. It acts only on instructions from the server.
- All **CSFloat** API calls stay **server-side** (they need our proxy pool, rate-limit
  handling, and CSFloat keys). The agent never talks to CSFloat.

Why: the ability to send Steam trades programmatically is already free (open-source
libs: `steam-user`, `steamcommunity`, `steam-tradeoffer-manager`, `steam-totp`). We
give away nothing by open-sourcing a thin agent. The moat is the server (pricing
engine, CSFloat orchestration, multi-account management, UI). **Every piece of logic
pushed into the agent is moat we delete.** This is also what makes the open repo safe:
a fork is inert without our server.

## 3. Deployment modes (one codebase, a config flag)

- **`local` mode** — runs on a customer machine, holds that customer's Steam secrets.
- **`hosted` mode** — the *same* agent binary running on our infrastructure, processing
  accounts whose owners chose server-side secret storage. This is the "global local
  machine." It reads secrets from our side (matches how today's `steam-nodejs` works).

Do **not** fork the business logic between modes. The only difference is *how a Steam
action is executed* (which secrets, which host); the trade/CSFloat orchestration on the
server is shared. Long-term target: everything runs the async model, and `hosted` is
just an always-online agent.

## 4. Transport — HTTPS pull, not exposed queues

The forcing function: a customer machine can be **offline** (asleep, NAT, home internet
down). You cannot block a webhook on it. Everything the agent does is therefore
**async** and driven by the agent pulling work over outbound HTTPS.

**Do NOT expose RabbitMQ to customer machines** (per-user creds, firewall pain,
connection churn, coupling our broker to a client we can't force-upgrade). Keep
RabbitMQ internal. A server-side queue handler just writes an `agent_tasks` row instead
of calling `steam-nodejs` directly.

### Agent API (Laravel, Sanctum-protected)

- `POST /api/agent/pair` — one-time pairing code (generated in Filament) → returns a
  scoped token bound to `user_id` + `machine_id`.
- `GET  /api/agent/tasks` — returns tasks **leased** to this agent (scoped by token).
- `POST /api/agent/tasks/{id}/result` — completes a task, resumes the server pipeline.
- `POST /api/agent/tasks/{id}/renew` — extend a lease during long Steam logins.
- `POST /api/agent/heartbeat` — liveness + per-account "logged in / online" status.
- `POST /api/agent/events` — local-cron findings (e.g. "account X has 3 actionable
  CSFloat trades"), if/when local scheduled checks are added.

### Poll cadence

- **Short-poll with adaptive interval + jitter.** Idle ~20–30s; drop to ~3–5s for a
  short window right after activity. Add ±20% jitter to avoid synchronized spikes.
- **Do NOT long-poll on PHP-FPM** (holds a worker per connection → worker exhaustion at
  ~30–50 machines). Long-poll/WebSocket require an async runtime (Node/Octane/Reverb).
- Server returns a `next_poll_ms` hint so cadence is server-controlled without shipping
  a new agent.
- 100 machines polling every 10s ≈ 10 req/s — trivial. Make the empty poll cheap: lean
  middleware, one indexed query, optional Redis `agent:has_pending:{userId}` flag to
  keep MySQL out of the hot path.

### Latency upgrade — the "poke", not a transport (v2, not v1)

For the **trade-send path only**, latency is a competitive feature (see §7). Pure 10s
polling adds *up to 10s per hop*; a multi-hop trade flow becomes ~30s, which tanks
`median_trade_time`. The fix is a persistent **WebSocket** — but with a strict rule:

- **Push a dumb signal, pull the real work.** The socket carries only a tiny
  `{"check":"now"}` **poke**; the agent responds by doing its normal
  `GET /api/agent/tasks`. Never push task *data* over the socket.
- **This keeps the socket stateless and disposable.** No ordering, no delivery
  guarantee, no state. It is a **latency dial on top of** the pull channel, **never a
  correctness dependency**: if the socket is down, the 10s poll still catches everything
  and the flow resumes when the machine returns.
- **Only the SIM → agent direction needs the poke.** Results coming back
  (`POST /tasks/{id}/result`, webhooks) are already instant outbound HTTP — don't
  over-build the socket for a direction that's already real-time. The poke fixes exactly
  one thing: task *delivery* to the agent.
- Effect: each hop drops from *up to 10s* → sub-second, so the flow is dominated by real
  Steam work (~2–4s) instead of poll waits.

**Infra:** the poke gateway **cannot live on PHP-FPM** (one held connection = one dead
worker → falls over at ~30–50 agents). Use a small always-on service — Laravel
**Reverb**/Soketi or a tiny Node "agent-gateway" (natural, since Node already runs
steam-nodejs). Agent holds **one outbound WebSocket**; when SIM enqueues a task it
publishes `poke(user_id, machine_id)` and the gateway forwards the poke. Keep the
message tiny and idempotent.

**Note:** the socket is also the auth/presence channel (see §9 → Authentication & session
model). If you adopt socket-gated tokens, the socket stops being a pure latency dial and
becomes a hard dependency for *any* work — that raises the HA bar for the gateway.

### Reduce hops, don't just speed them

Fewer round-trips beats faster ones. Two hops are avoidable:

- **CSFloat detection stays on SIM, never the agent.** The agent has no CSFloat access
  (thin-agent principle), so it must not "cron-check CSFloat and webhook us." CSFloat →
  SIM (webhook, or SIM polls CSFloat with its keys) is the entry point. *(The agent's
  legitimate cron role is checking **Steam** offer status — accepted/declined/escrow —
  which is a Steam action.)* The agent only discovers CSFloat trades if a customer also
  stored their CSFloat key locally — the v2 residential-IP opt-in, not v1.
- **Optimistic send collapses check + send into one task** (see §7): skip the pre-check,
  attempt the send, let `cannot-deliver` handle the rare missing-items case. Deletes a
  whole round-trip (one fewer poke + poll + Steam call).

With optimistic send + poke the happy path is ~2 server↔agent touches:
webhook → accept → (poke) → agent sends → result → mark done.

## 5. Task model & lifecycle

`agent_tasks` table (server side): `user_id`, `steam_account_id`, `type`, `payload`,
`status` (pending → leased → done/failed), `lease_expires_at`, `idempotency_key`,
`result`, timestamps.

- **Leases** handle crashes: expired lease → task returns to pending (bounded retries).
  Steam login can take ~120s, so support lease renewal.
- **Idempotency is non-negotiable.** If a "send trade" result is lost and the task
  re-leases, the agent must **not** double-send. Each send task carries an
  `idempotency_key` (= the order/trade entity id); the agent records "already created an
  offer for this key" and returns the existing `offer_id` on retry. Double-sending a
  trade is the worst bug this system can have — design it out from day one.
- **Deadlines / TTL.** CSFloat trades have `deadline_at` (~2h). Derive a task TTL from
  it. A reconciler cron sweeps tasks/orders stuck past TTL → fail them server-side +
  notify (Telegram). Don't let a sleeping laptop silently blow a deadline.
- **Routing** by `steam_accounts.execution_mode` (`server` | `local`): dispatch to the
  hosted pool or the user's machine. Scoping is enforced server-side by the token — an
  agent can only ever see its own user's tasks.
- **Priority lanes (separate pools).** The agent processes latency-critical trade-send
  tasks in a **fast lane** (poke-driven) kept separate from bulk status-check crons in a
  **slow lane** (poll-driven). A batch of "check 200 recent trades" must never delay a
  live send. Reflect this as a `priority`/`lane` on the task and on `GET /tasks`.

## 6. The trade flow as a state machine (local accounts)

Today's synchronous flow (`SteamTradeService`) blocks up to 180s calling `steam-nodejs`.
With remote agents it must become an async state machine on an order record. Steam steps
= agent tasks; CSFloat steps = server-side between them.

```
received            (from CSFloat webhook; dedup by csfloat_trade_id)
checking_items      (agent task: access + item availability)
items_unavailable   (terminal fail — decline/cannot-deliver on CSFloat)
accepted            (server accepted on CSFloat — obligation clock started)
sending             (agent task: create steam trade offer)
completed           (offer sent + marked done on CSFloat — success)
failed              (send failed → cannot-deliver called on CSFloat)
expired             (agent offline past deadline → cannot-deliver + notify)
```

Rules:

- **Accepting on CSFloat commits you** to a ~2h delivery. The send-failure branch and
  the deadline branch **must call CSFloat `cannot-deliver`** (already implemented
  server-side: `CsfloatTradesApi::cannotDeliver()`), which cancels the sale without
  penalty. This is the `eresult 15 / buyer-cannot-receive` case we already handle.
- **Gate the CSFloat accept on recent proof-of-life.** The items check is itself a Steam
  action, so `items_available` proves the machine was just online — accept immediately
  and push the send task right away to keep the accept→send window tiny.
- **Persist the transient states** (`accepted`, `sending`) so a reconciler can resume
  after a crash.
- **Keep CSFloat/trade rules in shared code.** Only "how a Steam action executes"
  differs between hosted (inline) and local (task) — don't copy-paste accept/mark-done/
  cannot-deliver into two paths.

## 7. Latency requirement (this is a product feature)

CSFloat shows **`median_trade_time`** in the seller profile; faster = better standing =
more sales. So for the **send path**, latency matters (the hard 2h deadline is not the
constraint — the competitive metric is).

- **A warm Steam session is core** for local trade-sends. The agent must keep the account
  **logged in / session pre-warmed** (heartbeat) so a send task has zero login latency
  (~1–3s warm vs up to 120s cold). This matters regardless of transport — do it early.
- **The poke (WebSocket nudge) is what makes the send *fast* to reach the agent.** It's
  the specific latency upgrade for this path (see §4) — added when chasing
  `median_trade_time`, with poll as the permanent fallback.
- **Physics:** local accounts will always be a few seconds slower than hosted (home
  network + 2 extra hops). Sell this honestly: **hosted = fastest, local = maximum
  security, a few seconds slower.** Don't chase "local as fast as hosted" — impossible
  without putting secrets on our servers, which is what these customers refused.
- **Hop-collapse decision (the key latency lever):** the flow is 2 agent round-trips
  (check items → accept → send). Consider **optimistic send** — skip the pre-check,
  attempt the send, and let `cannot-deliver` handle the rare missing-items case — to cut
  it to **1 hop**. This trades a slightly higher `total_failed_trades` for lower latency.
  **The decision hinges on one number the operator knows: how often items are actually
  missing when an order arrives.** Low → go optimistic. Common → keep the pre-check.

## 8. What stays where (the boundary)

| Concern                                   | Server (`sim`) | Agent |
|-------------------------------------------|:--------------:|:-----:|
| Steam secrets                             |  hosted only   |  ✅   |
| Steam login / session / heartbeat         |                |  ✅   |
| Send trade offer / mobile confirm         |                |  ✅   |
| Inventory fetch (Steam)                   |                |  ✅   |
| CSFloat API (orders, accept, listings, withdraw, cannot-deliver) | ✅ | |
| Pricing engine                            |      ✅        |       |
| Proxy pool + rotation                     |      ✅        |       |
| Order state machine / orchestration       |      ✅        |       |
| Admin UI / config / notifications         |      ✅        |       |

## 9. Security requirements (this audience will scrutinize)

- Secrets imported **locally** (CLI prompt or maFile import), **encrypted at rest** —
  libsecret on Linux, DPAPI on Windows, passphrase fallback.
- Secrets **never** appear in task payloads, results, or logs. The protocol makes this
  structurally true — auditors of the open repo can verify it.
- **Signed + reproducible builds** are the *actual* trust mechanism: a user must be able
  to build the published source and get the same signed binary they run. This matters
  more than the license text for this audience.
- Server URL is **config, not hardcoded**. Outbound-only HTTPS (works through any NAT).

### Authentication & session model (socket-gated, rotating tokens)

The socket is not only the poke channel — it is the **presence + auth channel**. Work
requires **an active socket AND a valid session token**; no live socket → no valid token
→ no API access. This makes single-active-agent an **auth-layer guarantee** instead of
something the lease merely hopes to catch.

OAuth-shaped, with the socket as the presence/refresh channel:

- **Pairing token** — long-lived, bound to `(user_id, machine_id)`, issued once at
  pairing. Used **only** at the socket handshake, never on regular HTTP calls (think:
  refresh token). Minimal exposure.
- **Session token** — short-lived (TTL ~60–120s), issued when the socket authenticates.
  This is what authorizes every HTTP call (`GET /tasks`, `POST /result`, …) (think:
  access token).
- **Rotate on every refresh/reconnect.** Each heartbeat/reconnect issues a **brand-new**
  session token and retires the previous one — do **not** just extend the TTL of the same
  token. Rotation is what makes a copied token hard to use: two machines can't both hold
  the *current* token.
- **Reuse detection = compromise signal.** If a retired (rotated-out) token is ever
  presented — e.g. a clone on a second machine replaying an old token — the server treats
  it as theft: revoke the session (and optionally the pairing), force re-pairing, alert.
- **Supersede = revoke.** A new socket for the same `machine_id` immediately revokes the
  previous session token → the old/duplicate agent instantly loses API access.

Two consequences to accept **consciously** (this promotes the socket/gateway from a
latency dial to a **hard dependency for any work**):

1. **The gateway must be HA.** If it is down, no agent can (re)issue a token → *all*
   agents stop, not just "trades get slower." Plan redundancy/failover.
2. **TTL grace so flaky sockets don't thrash.** Home networks drop sockets constantly. A
   ~60–120s TTL survives brief blips (a ~1s reconnect refreshes well before expiry); only
   a *genuinely gone* agent's token lapses (→ server re-leases its tasks). Without the
   grace, a flapping socket = a constant re-auth storm.

This does **not** replace the correctness floor — keep both:

- **Leases + idempotency** still guard against double-processing. A token-rotation race
  (old token valid for a few ms while the new one issues) must never become a
  double-send.
- **Per-account active lock** is still separate: auth-single-active is per `machine_id`;
  if a fleet is ever allowed, two different machines can each hold a valid socket+token
  yet target the **same Steam account** → concurrent Steam logins thrash. Enforce one
  active agent *per account* at the account layer.

## 10. Build order

1. Protocol spec (OpenAPI) + `agent_tasks` table + agent API endpoints. **Pull-only**
   (adaptive short-poll + `next_poll_ms`) — correct and ~10–30s, fine to ship first.
2. Refactor the trade pipeline to async (dispatch → result). **Test with hosted mode
   only** — i.e. our own `steam-nodejs` becomes the first "agent." Zero customer risk;
   de-risks the hardest change.
3. **Collapse hops** (CSFloat detection on SIM, optimistic send) — biggest latency win
   before any socket. Add priority lanes (fast trade lane vs slow cron lane).
4. Extract the agent binary (Linux + systemd; Docker image optional), Filament pairing
   UX, `execution_mode` per account, heartbeat/health.
5. Warm-session keep-alive + the **poke gateway** (WebSocket nudge; poll stays the
   fallback) — the send-path latency work, only once chasing `median_trade_time`.
6. Local scheduled checks + `events` endpoint (optional; enables residential-IP CSFloat
   checks later — a bonus vs the datacenter-proxy Cloudflare blocks).
7. Windows service, auto-update, signed/reproducible builds.

## 11. Open decisions

- **Long-poll vs WebSocket for v1** → recommended: short-poll, add push later.
- **Scope of local secrets** → Steam only (recommended v1) vs Steam + CSFloat key
  (enables local CSFloat checks from a residential IP — a v2 opt-in).
- **One machine per user vs a fleet** → put `machine_id` on the token now (cheap) even if
  UI supports one, so fleet-per-user is designed in.
- **Optimistic send vs pre-check** → depends on the operator's real items-missing rate
  (see §7).
- **Hosted pool runtime** → same agent in hosted mode (recommended) vs keep current
  `steam-nodejs` path during transition (you can route by `execution_mode` and migrate
  gradually).
- **Socket-gated auth (hard dependency) vs poll-resilient auth** → socket-bound rotating
  tokens (§9) give strong single-active + anti-clone but make the gateway a hard
  dependency (needs HA + TTL grace). The alternative keeps a pairing-token poll fallback
  and enforces single-active only via lease + per-account lock. Leaning socket-gated;
  confirm the HA commitment before building.

## 12. Licensing

Source-available under **FSL-1.1-Apache-2.0** (`LICENSE.md`): run/modify for your own
use, **no competing product/service**, auto-converts to Apache-2.0 two years per
release. Describe it as "source-available," **not** "open source." Only the **agent**
repo carries this license — the `sim` server stays proprietary and unpublished.
Pre-publish: diff the license text against canonical FSL-1.1 and set the copyright holder
to your legal entity.

## 13. Reference points in the existing `sim` codebase

- `services/steam-nodejs/` — current Steam execution service; the agent is largely an
  extraction/standalone-ification of this. Becomes the first `hosted` agent.
- `app/Services/Steam/SteamTradeService.php` — current synchronous trade flow to split
  into the async state machine; already contains `eresult 15` detection and the
  `cannot-deliver` call.
- `app/Api/Csfloat/CsfloatTradesApi.php::cannotDeliver()` — the CSFloat cancel-without-
  penalty call the failure/deadline branches must use.
- `app/Queues/` — existing RabbitMQ queue handlers; a handler will write `agent_tasks`
  instead of calling steam-nodejs directly.
- `app/Models/SteamAccount.php` — add `execution_mode`; holds Steam secrets (encrypted)
  for hosted accounts.
