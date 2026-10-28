# magpie-inscode

Run **InsCode free quota** as a provider inside [magpie](https://usemagpie.ai) (and OpenCode).

Login is a **browser OAuth** at `https://taotoken.net/oauth?sid=<uuid>`: you
authorize there, the page binds the session, and the plugin picks it up from the
*complete* endpoint, then uses the returned `api_key`. Model requests go to the
console gateway `https://api.taotoken.net/v1` with a plain Bearer header, so
`inscode/deepseek-v4-flash` becomes a normal, OpenAI-compatible provider you can
pick from any agent.

> Built against the SDK-side logic of [`inscode2api`](https://github.com/…/inscode2api),
> a zero-dependency local proxy that turns the same InsCode quota into an
> OpenAI API. This plugin does the equivalent work entirely inside magpie's
> plugin host — no proxy process needed.

## Install

Add it from the magpie UI (**Plugins → Add → folder path**) or on the CLI:

```bash
magpie plugin add ./magpie-inscode   # local folder, nothing is installed
```

Then sign in and test:

```bash
magpie plugin login inscode           # opens the browser OAuth sign-in
magpie plugin                         # inscode (InsCode, N models) signed in
magpie provider test inscode          # ✓ chat  …ms · deepseek-v4-flash
magpie quota                          # inscode · InsCode 免费套餐 · …
```

Your models are then available as `inscode/<model>` alongside every other
provider.

## How it logs in

The primary login is a **browser OAuth** keyed by a random session id: the plugin
opens `https://taotoken.net/oauth?sid=<uuid>`, you authorize there, and the page
binds that session to your account. That page then deep-links into the InsCode
desktop app (`inscode://auth/callback`), so a plugin cannot read the browser.
Instead the plugin polls the app-side endpoint
`POST https://api.taotoken.net/v1/codex/session/<sid>/complete?deviceId=<id>`
(unauthenticated, `X-Tt-Device-Id` header) until it reports `SUCCESS`, then stores
the returned `apiKey`. Claiming is idempotent, so the desktop app may claim the
same session too.

| Login | What happens |
|---|---|
| Browser OAuth (default) | open `…/oauth?sid=…`, poll `…/codex/session/<sid>/complete` for the `apiKey` |
| Local credentials (fallback) | read `~/.config/inscode/{taotoken,device,auth}.json` directly |

Everything stays on this machine — the values are only sent to the taotoken
gateway as the `Authorization` header.

## How requests are signed

They aren't. Model requests go to the **console API-key gateway**
`https://api.taotoken.net/v1` with a plain `Authorization: Bearer <api_key>`
— the X-Tt client signature is no longer used.

`loader.baseURL` is `https://api.taotoken.net/v1` with
`@ai-sdk/openai-compatible`, so chat-completions requests land on
`https://api.taotoken.net/v1/chat/completions`.

## Magpie-native hooks

- **`auth.usage`** (`quota.mjs`) — reports the free-quota window from the
  account snapshot stored at login (or the local `taotoken.json` for the
  fallback login); falls back to a plan row with an empty window list. Shows up
  under **magpie quota** and the account row.
- **`auth.checkin`** (`checkin.mjs`) — daily free-quota claim. The taotoken
  check-in endpoint is **not verified**, so the hook only acts when you set
  `INCODE2API_CHECKIN_URL` (POST, Bearer auth). Without it, it reports
  `inactive` — no retries, no false claims.
- **`auth.refresh`** — not needed: the account `api_key` is stored at login and
  requests are plain Bearer to the console gateway.

## Provider models

Per-account models are fetched from `GET /v1/models` (Bearer only) inside the
account's scope and mapped onto the static list — a low-tier account only sees
the models it actually has.

## Files

```
index.mjs     plugin entry: config, auth (methods/loader/usage/checkin), provider
internal.mjs  PROVIDER id, DEFAULT_API_BASE, inlined icon, shared helpers
oauth.mjs     browser OAuth: sid, authorize URL, session-complete polling
creds.mjs     load & parse the local InsCode credential files (fallback login)
models.mjs    model fallback, normalization, per-account catalog
quota.mjs     free-quota → auth.usage mapping
checkin.mjs   daily check-in hook (opt-in)
i18n.mjs      zh/en UI strings
assets/       provider icon (inlined at load)
test/         `node --test` unit tests (oauth / quota / i18n / models / creds)
```

## Options

The plugin entry reads an optional `options` object
(`magpie plugin options <name> '{"locale":"zh", …}'`):

| Option | Default | Meaning |
|---|---|---|
| `locale` | `auto` | `"zh"`, `"en"`, or follow the machine. |
| `apiBase` | `https://api.taotoken.net/v1` | Override the taotoken gateway base. |
| `deviceId` | desktop app's `device_id` | Device id sent to the session-complete endpoint. |
| `modelsTtlMs` | `600000` | How long one account's model list is cached. |
| `maxOutputTokens` | `8192` | Default output window for models lacking one. |
| `quotaTtlMs` | `60000` | How long a `usage` result is cached per account. |

## Tests

```bash
node --test test/*.test.mjs     # 35 unit tests
npm test                        # same
```

## Security notes

- Credentials are used **only** in the plugin-host process to talk to
  taotoken.net; they are never logged or sent anywhere else.
- Prefer running magpie/agents on your own machine. Since the plugin reuses
  your InsCode login, do **not** expose this provider's requests over an
  untrusted network or to a multi-user gateway that could burn your quota.
- A rotated `sign_key` (has a `expire_at`) is re-picked up automatically,
  because it is read from disk per request — restart the InsCode client if the
  gateway starts answering `401 invalid_client_signature`.

## Limitations

- `auth.usage` and `auth.checkin` are best-effort until the taotoken
  quota/check-in endpoints are confirmed; chat and models are unaffected.
- Only the primary free account is wired; multi-account / `pros` plans are not
  exposed as separate accounts yet.

## License

MIT