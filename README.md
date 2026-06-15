# mikser-io-ngrok

[ngrok](https://ngrok.com) tunnel plugin for [mikser-io](https://github.com/almero-digital-marketing/mikser-io). Opens a tunnel to the local `--server` port at startup and stamps the public URL on `runtime.options.url`. Every downstream plugin that already uses the URL — mount logs, MCP preview URLs, post-email tracking links, future webhook receivers — picks it up automatically. No further wiring.

## Why a plugin

Multi-project agencies hit the same shape: dev / staging URLs need to be externally reachable for webhook testing, agent integrations, share-this-preview workflows. Without a plugin, every consuming `mikser.config.js` repeats the same `await ngrok.forward({...})` boilerplate. With ten projects, the duplication stops being acceptable. This is the centralised, testable, swap-the-token-and-go version.

## Install

```bash
npm install mikser-io-ngrok
```

Peer dep on `mikser-io ^9`. Hard dep on `@ngrok/ngrok`.

## Get an ngrok authtoken

1. Sign up at https://dashboard.ngrok.com (free tier works for most dev / demo workflows)
2. Grab your authtoken at https://dashboard.ngrok.com/get-started/your-authtoken
3. Drop it in `.env`:
   ```bash
   NGROK_AUTHTOKEN=2abc...
   ```

Free tier limits in practice: one concurrent tunnel per authtoken, random subdomain per session, ~40 requests/minute. Sufficient for dev / agent-integration testing. Paid plans get reserved domains, OAuth-protected endpoints, higher request rates.

## Use it

```js
// mikser.config.js
import { ngrok } from 'mikser-io-ngrok'

export default {
    plugins: [
        ngrok(),                      // picks up NGROK_AUTHTOKEN from env
        // ... your other plugins
    ],
}
```

Run with a server:

```bash
mikser --watch --server 3001
```

You'll see:

```
ngrok tunnel: https://abc123.ngrok-free.app → localhost:3001
MCP mounted: https://abc123.ngrok-free.app/mcp [...]
Api endpoint mounted: https://abc123.ngrok-free.app/api/public [...]
Vector search mounted: https://abc123.ngrok-free.app/vector/:storeName
Preview route mounted: https://abc123.ngrok-free.app/preview [...]
Server listening: https://abc123.ngrok-free.app
```

Mount logs, MCP tools, every URL surface in the project — all on the public origin.

## Options

```js
ngrok({
    // Explicit token override; falls back to process.env.NGROK_AUTHTOKEN.
    authtoken: process.env.NGROK_AUTHTOKEN,

    // Paid plan: reserved domain. Keeps the same URL across restarts so
    // webhook registrations / agent endpoints don't go stale.
    // domain: 'my-mikser.ngrok.app',

    // Paid plan: regional pinning. Reduces latency for users in
    // specific geographies. One of: us, eu, ap, au, sa, jp, in.
    // region: 'eu',

    // Basic-auth gate at the edge. Useful for staging / preview URLs
    // you don't want indexed.
    // basicAuth: ['preview:hunter2'],

    // Tag the session so it shows up labelled in the ngrok dashboard.
    // metadata: 'mikser-blog-staging',

    // Escape hatch: anything in @ngrok/ngrok's forward() option bag.
    // forward: { proxy_proto: 'PROXY' },
})
```

## Graceful skip rules

The plugin never throws. It logs a short reason and steps aside:

| Condition | What you see | Behavior |
|---|---|---|
| `mikser` runs without `--server` | (silent / debug log) | No tunnel. One-shot builds don't need one. |
| `NGROK_AUTHTOKEN` unset AND no `authtoken:` option | `ngrok: NGROK_AUTHTOKEN not set, running on localhost only` | No tunnel. Mount logs show `http://localhost:<port>`. |
| `ngrok.forward()` throws (network / invalid token / plan limit) | `ngrok tunnel failed: <message> — running on localhost only` | No tunnel. Other plugins keep working unchanged. |
| Tunnel opens successfully | `ngrok tunnel: https://<id>.ngrok-free.app → localhost:<port>` | `runtime.options.url` is set. Every downstream consumer (mount logs, MCP, post-email, etc.) uses the public URL. |

## Cleanup on shutdown

SIGINT and SIGTERM close the tunnel cleanly. This matters because free-tier accounts cap concurrent tunnels per authtoken — leaving zombie sessions around means the next `mikser --watch` may fail to start a tunnel with `account_limited`. The plugin's `process.once('SIGINT', …)` / `process.once('SIGTERM', …)` handlers run alongside any other shutdown logic; nothing is skipped.

If mikser is killed with `kill -9` or crashes, the tunnel times out on ngrok's side within ~30 seconds.

## Hook ordering

The plugin uses `onLoaded`, which fires after engine init and after config-file load. The flow:

1. CLI parsed: `runtime.options.server` is set (port number).
2. Engine's url resolution at `onLoad`: reads `runtime.config.url` / `runtime.options.url` (CLI flag). For projects using this plugin, both are likely unset at this point.
3. Plugin's `onLoaded`: tunnel opens, `runtime.options.url` is stamped.
4. Server starts (`server.js` `onLoaded`): mount log reads `runtime.options.url`, shows the public URL.

The engine's earlier "Public URL not set" debug log will fire if no `--url` / `config.url` was provided. The plugin's `ngrok tunnel: ...` info log is the authoritative line — operator should look at that.

## What this plugin does NOT do

- **Doesn't survive ngrok dashboard rotations.** Free-tier subdomains change every session. For long-running webhook registrations (e.g. GitHub repo webhooks pointing at your tunnel), use a paid reserved `domain:` or switch to `cloudflared` / `tailscale-funnel`.
- **Doesn't restart automatically if the tunnel dies mid-process.** ngrok's session can drop on network blips; the SDK auto-reconnects when it can, but on permanent failure the URL goes stale. A future v1.1 may add a health-check + restart loop; for now, mikser restart is the fix.
- **Doesn't bridge multiple ports.** One tunnel, one port (the `--server` port). Other plugins that expose HTTP (none currently) would share that same tunnel via path routing.
- **Doesn't replace production deployment.** This is for dev / staging / demo workflows. Production should have a stable URL on real infrastructure.

## Alternatives in the same shape

These don't exist yet but would follow the same plugin contract (`runtime.options.url` set at onLoaded):

- `mikser-io-cloudflared` — `cloudflared tunnel` with a hostname under a Cloudflare-managed zone. Better for production-ish dev setups.
- `mikser-io-tailscale-funnel` — exposes the mikser server over the Tailscale network with a `*.ts.net` URL. Useful for team-internal access without public exposure.

Same shape; swap the import.

## License

MIT
