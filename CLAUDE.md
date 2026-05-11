# ursamu-discord-plugin — Claude Code Instructions

## Project identity

Standalone Deno/JSR package (`@ursamu/discord-plugin`) providing webhook-based
Discord integration for UrsaMU games — mirrors job events, channel talk, player
presence, and chargen activity to Discord. This is **not** inside the engine
repo; it is a consumer of `jsr:@ursamu/ursamu`.

### Output is webhook JSON — NOT MUSH-rendered text

Discord output is composed as **Discord webhook payloads** (JSON: `content`,
`embeds`, `username`, `avatar_url`). It is sent over HTTPS to a Discord webhook
URL and rendered by Discord, not by the MUSH client.

**Implication for v2.3 format-attribute hooks:** the engine's v2.3
`@joblistformat` / `@jobrowformat` / `@psformat` style hooks exist to override
MUSH-rendered terminal output. They do **not** apply here. Do not add
format-attribute hooks to this plugin. If a future maintainer wants a Discord
post template, design it as a JSON/embed template (e.g. a plugin-specific
config attribute resolving to an embed shape), not as a `%c*`-based MUSH
format hook. Mentioned explicitly so nobody wastes cycles plumbing FormatSlot
into webhook code.

User strings are still cleaned with `clean()` / `u.util.stripSubs()` before
embedding into Discord payloads (MUSH color codes / control sequences must
not leak into Discord).

---

## Commands

```bash
deno task test         # alias for: deno test --allow-all --unstable-kv --no-check tests/
deno check mod.ts      # type check
deno lint              # must be clean
deno publish --dry-run # verify publish config before tagging
```

## Pre-commit checklist (all must pass before every commit)

```bash
deno check --unstable-kv mod.ts
deno lint
deno test --allow-all --unstable-kv --no-check tests/
```

---

## Repo layout

```
src/
  index.ts          IPlugin definition (init, remove) + channel hook
  commands.ts       @discord admin commands (addCmd registrations)
  router.ts         REST /api/v1/discord handler
  config.ts         DBO<IDiscordConfig>("discord.config") — webhook URLs, public URL
  webhook.ts        postWebhook() — fire-and-forget HTTPS POST to Discord
  helpers.ts        clean(), resolveAvatar(), COLORS — payload-prep utilities
  job-hooks.ts      jobs-plugin hook subscribers → webhook posts
  presence.ts       gameHooks + chargenHooks subscribers → webhook posts
tests/              Deno test files
mod.ts              Public API exports
index.ts            Plugin entry point (re-exports default from src/index.ts)
ursamu.plugin.json  Plugin manifest
deno.json           Package config
```

---

## Imports — always use the import map

```typescript
// All source files in this repo (deno.json import map)
import { addCmd, DBO, dbojs, gameHooks, registerPluginRoute } from "@ursamu/ursamu";
import type { ICmd, IPlugin, IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import { channelEvents } from "@ursamu/ursamu/channels";
import { chargenHooks } from "@ursamu/ursamu/chargen";
import { jobHooks } from "@ursamu/jobs-plugin";
```

Never use relative imports into the engine. Never import from `ursamu` source
paths.

---

## addCmd skeleton

```typescript
addCmd({
  name: "@discord",
  pattern: /^@discord(?:\/(\S+))?\s*(.*)/i,  // args[0]=switch, args[1]=rest
  lock: "connected admin+",
  category: "Admin",
  help: `@discord[/<switch>] <channel> [<url>]  — Manage Discord webhooks.

Switches:
  /set    Bind channel name → webhook URL.
  /clear  Remove binding for a channel.

Examples:
  @discord/set ooc=https://discord.com/api/webhooks/...
  @discord/clear ooc`,
  exec: async (u: IUrsamuSDK) => {
    const sw  = (u.cmd.args[0] ?? "").toLowerCase().trim();
    const arg = u.util.stripSubs(u.cmd.args[1] ?? "").trim();
    // ...
  },
});
```

### Catch-all switch pattern — critical gotcha

When a command uses the catch-all switch pattern `/^@cmd(?:\/(\S+))?\s*(.*)/i`,
**any more-specific `addCmd` registered for the same prefix will never match**.
Route sub-commands as switch branches inside the main `exec`, not as separate
`addCmd` registrations.

### Lock levels

| String | Who can use it |
|--------|----------------|
| `"connected"` | Any logged-in player |
| `"connected admin+"` | Admin flag or higher |
| `"connected wizard"` | Wizard only |

### Lockfunc system (v2.2+)

Lock strings support callable functions: `funcname(arg1, arg2)` combined with
`&&`, `||`, `!`, and `()` grouping. Built-ins: `flag`, `attr`, `type`, `is`,
`holds`, `perm`. Register custom funcs via `registerLockFunc(name, fn)` —
built-in names are protected. Locks are fail-closed.

---

## Key SDK idioms

```typescript
// Target resolution — always guard null
const target = await u.util.target(u.me, rawName, true);
if (!target) { u.send("Not found."); return; }

// Strip MUSH codes BEFORE DB ops, length checks, or embedding in webhook JSON
const clean = u.util.stripSubs(u.cmd.args[0]).trim();

// Admin check (or use isStaff() helper in router.ts)
const isStaff = u.me.flags.has("admin") || u.me.flags.has("wizard") || u.me.flags.has("superuser");
```

---

## Plugin architecture (three phases — non-negotiable)

```
Phase 1 — module load   import "./commands.ts" → addCmd() fires at load time
                        (NOT in init)
Phase 2 — init()        wire channelEvents / jobHooks / gameHooks / chargenHooks
                        listeners, registerPluginRoute → return true
Phase 3 — remove()      every .on() paired with .off() using the SAME named
                        function reference
```

```typescript
// src/index.ts
import "./commands.ts";                                    // Phase 1
import { gameHooks, registerPluginRoute } from "@ursamu/ursamu";
import { channelEvents } from "@ursamu/ursamu/channels";
import type { IPlugin } from "@ursamu/ursamu";

const onChannelMessage = async (e: ChannelMsg) => { /* ... */ };
// named refs — required for symmetric .off() in remove()

export default {
  name: "discord",
  version: "1.1.2",
  description: "Webhook-based Discord integration.",
  init: () => {
    channelEvents.on("channel:message", onChannelMessage);
    subscribeJobHooks();
    subscribePresenceHooks();
    registerPluginRoute("/api/v1/discord", discordRouteHandler);
    return true;                                           // must return true
  },
  remove: () => {
    channelEvents.off("channel:message", onChannelMessage);
    unsubscribeJobHooks();
    unsubscribePresenceHooks();
  },
} satisfies IPlugin;
```

**DBO namespace rule** — all collections prefixed `discord.`:

```typescript
const cfg = new DBO<IDiscordConfig>("discord.config");   // correct
const cfg = new DBO<IDiscordConfig>("config");           // wrong — collides
```

---

## v2.3 engine API surface (reference only — not used here)

ursamu v2.3 ships format-attribute hooks (`@joblistformat`, `@psformat`, etc.)
and the `FormatSlot` union, plus `registerPluginFormatHandler`. They override
MUSH terminal output. **This plugin does not use them** — see the identity
section above. Listed here so future maintainers know the surface exists and
why it is intentionally absent from this repo.

The lockfunc registry (v2.2) **does** apply to this plugin's `addCmd` `lock:`
strings — see the Lockfunc section above.

---

## Webhook output rules

- Always `clean()` (or `u.util.stripSubs()`) user strings before embedding into
  `content`, `embeds[].title`, `embeds[].description`, or `username` fields.
- Never log webhook URLs at info level — they are secrets.
- `postWebhook()` is fire-and-forget; any await chain that blocks an in-game
  command on Discord latency is a bug.
- 401 / 404 from Discord must not raise — webhooks can be revoked externally.

---

## Test patterns

### Required boilerplate

```typescript
const OPTS = { sanitizeResources: false, sanitizeOps: false };
Deno.test("description", OPTS, async () => { /* ... */ });
```

### What to test

- Webhook URL lookup returns `undefined` → no POST attempted.
- `clean()` strips `%c*`, `%r/%t/%b`, ANSI before payload assembly.
- REST router returns 401 before any work when `userId` is null.
- Admin guards: non-staff caller rejected.
- DB writes use `"$set"` / `"$unset"` — never raw overwrite.

Use a `fetch` stub or `globalThis.fetch` override to assert payload shape
without hitting Discord.

---

## Code style (non-negotiable)

- **Early return** over nested conditions
- **No function longer than 50 lines** — decompose
- **No file longer than 200 lines** — split
- **No bare `catch`** — always `catch (e: unknown)`
- **No deep nesting** — max 3 levels
- **No comments** unless the WHY is non-obvious

---

## Audit checklist (run mentally before every PR)

- [ ] `u.util.stripSubs()` / `clean()` on all user strings before DB writes or
      webhook payload assembly
- [ ] All DB writes use `"$set"` / `"$inc"` / `"$unset"` — never raw overwrite
- [ ] `u.util.target()` result null-checked before use
- [ ] Admin-only actions check `u.me.flags` explicitly (or `isStaff()`)
- [ ] Every `addCmd` has `help:` with syntax line + Switches section + ≥2
      examples
- [ ] Every `.on()` in `init()` paired with `.off()` in `remove()` — same
      named function reference
- [ ] DBO collection names prefixed with `discord.`
- [ ] REST route handlers return 401 before any work when `userId` is null
- [ ] `init()` returns `true`
- [ ] No format-attribute hooks added (webhook JSON output is not
      MUSH-rendered text)
- [ ] Webhook URLs never logged or returned in REST responses to non-staff
- [ ] `postWebhook()` failures do not block the originating in-game command

---

## PRs and commits

- No Claude/AI attribution in PR titles, commit messages, or code comments.
- Use squash-merge for feature PRs.
- Tag versions after squash-merge: `git tag v<version> && git push --tags`.
