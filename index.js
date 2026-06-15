// mikser-io-ngrok — opens an ngrok tunnel to the local --server port at
// startup and stamps the public URL on runtime.options.url. Downstream
// plugins that gate on https-capable reachability (mount logs, MCP
// preview URLs, post-email tracking links, future webhook receivers
// like gdrive push notifications or github webhooks) pick it up
// automatically because the engine already reads runtime.options.url
// as the canonical "how does the outside world reach me" handle.
//
// What this plugin replaces: the inline `await ngrok.forward({...})`
// boilerplate every consuming project would otherwise paste into its
// config file. With ten projects sharing the same flow, the duplication
// stops being acceptable.
//
// Graceful skip rules (each logs a short reason; nothing throws):
//   - --server isn't active → no port to tunnel to.
//   - No authtoken (option or NGROK_AUTHTOKEN env) → no tunnel.
//   - ngrok.forward throws (network, invalid token, plan limits) →
//     warn, leave runtime.options.url alone.
//
// Cleanup: SIGINT / SIGTERM close the listener cleanly so the next
// `mikser --watch` gets a fresh allocation and you don't pile up
// zombie sessions on free-tier accounts (which cap concurrent tunnels
// per authtoken).

import * as ngrokSDK from '@ngrok/ngrok'

export function ngrok(options = {}) {
    return ({ runtime, onLoaded, useLogger }) => {
        onLoaded(async () => {
            const logger = useLogger()

            if (!runtime.options.server) {
                logger.debug('ngrok: --server not active, skipping tunnel')
                return
            }

            const authtoken = options.authtoken ?? process.env.NGROK_AUTHTOKEN
            if (!authtoken) {
                logger.info('ngrok: NGROK_AUTHTOKEN not set, running on localhost only')
                return
            }

            const port = typeof runtime.options.server === 'number'
                ? runtime.options.server
                : 3001

            // Build the forward config from supported options. Anything
            // unrecognised passes through to @ngrok/ngrok so consumers
            // get the full SDK surface without us mirroring every option.
            const forwardConfig = {
                addr: port,
                authtoken,
                ...(options.domain     ? { domain: options.domain }       : {}),
                ...(options.region     ? { region: options.region }       : {}),
                ...(options.basicAuth  ? { basic_auth: options.basicAuth } : {}),
                ...(options.metadata   ? { metadata: options.metadata }   : {}),
                ...(options.forward    ?? {}),   // escape hatch for any other SDK field
            }

            let listener
            try {
                listener = await ngrokSDK.forward(forwardConfig)
            } catch (err) {
                logger.warn('ngrok tunnel failed: %s — running on localhost only', err.message)
                return
            }

            const url = listener.url()
            runtime.options.url = url
            logger.info('ngrok tunnel: %s → localhost:%d', url, port)

            // Close the tunnel cleanly when the process is asked to
            // stop. Best-effort: ngrokSDK.disconnect/close may throw if
            // the listener was already torn down by an earlier signal
            // or by the SDK's own watchdog — swallow those.
            for (const sig of ['SIGINT', 'SIGTERM']) {
                process.once(sig, async () => {
                    try { await listener.close() } catch { /* best-effort */ }
                })
            }
        })
    }
}
