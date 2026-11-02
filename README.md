# ClearQuote

ClearQuote turns a furniture request into an itemized quote, keeps customer revisions as explicit versions, and collects payment with PayPal Sandbox after customer approval. AI extracts dimensions, material, drawers, and delivery; the catalog calculates prices. The owner reviews every draft before sending it.

## Run the prepared demo

1. Install **Node.js 24 LTS** from <https://nodejs.org>.
2. Extract the complete prepared archive. On Windows, double-click **Start-ClearQuote.cmd**. On Linux, run `node launch.mjs` in the extracted folder.
3. Privately paste the **existing ClearQuote PayPal Sandbox Client ID**, then **Secret key 1**, into the masked terminal prompts. These values go to the child application process, are not written to a file, and are not supplied to Cloudflare.
4. The launcher downloads the official Cloudflare `cloudflared` 2026.10.7 binary and verifies its pinned published SHA-256 before running it. A temporary HTTPS server starts. The launcher opens the already approved Admas frontend with a private, run-scoped connection to that server. The access token travels only in the URL fragment, is removed before rendering, and stays in this tab's session storage. Keep the terminal open.
5. The interface stays on the project's approved Admas origin, so a new tunnel does not require another AI-origin registration. `review-frontend.json` identifies the reviewed frontend. The server permits only that exact frontend origin plus the private run token; app-user AI authentication remains separate. Do not publish the complete private launch link.
6. In the app, select **AI sign-in**, enter your email, then paste the sign-in link from your email into the masked confirmation field without opening the link. A numeric email code is also supported. The first sign-in creates an app authentication user in the attached Supabase staging project.
7. Create a quote, review its catalog prices, send it, approve the same version from the customer portal, and complete checkout using a **PayPal Sandbox personal buyer account**. A real PayPal account or bank card must not be used for this demo.

Press Ctrl+C in the terminal to stop both processes. The temporary link expires. Restarting creates a new private connection and invalidates the previous token. A local-only option, `node launch.mjs --local`, supports Sandbox checkout on loopback; AdmasLLM requires a registered HTTPS origin.

The prepared archive includes compiled frontend assets. `node launch.mjs --check` validates the package without credentials or provider calls. Node dependencies are required only when rebuilding source.

## Rebuild from source

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node launch.mjs
```

For manual local development, set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the server environment and run `npm start`; the default server binds only to `127.0.0.1:3000`. `.env.example` documents the optional OpenAI-compatible server adapter. AdmasLLM does **not** require `AI_API_KEY`.

To test with your own OpenAI-compatible provider instead, remove `public/admas-public-config.json` and unset `VITE_ADMAS_LLM_URL` / `VITE_ADMAS_LLM_KEY` before rebuilding. Set `AI_API_KEY`, and optionally `AI_BASE_URL` / `AI_MODEL`, only in the Node server environment. The prepared owner demo uses AdmasLLM by default.

## Interface and review

The business workspace has quote search, workflow totals, a staged price catalog, and editable specifications. Native dialogs keep actions available on short screens, restore keyboard focus, and support Escape. Customer revisions preserve previous versions and require another business review. Prices use exact cents; blank or fractional drawer counts and invalid catalog prices stay unresolved.

The repository includes a read-only GitHub Actions workflow that installs the lockfile, builds, runs fake-provider checks and lint, and uses no provider credentials.

## AI configuration and authentication

`public/admas-public-config.json` contains public app connection metadata only. Equivalent Vite bindings are `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (or the public anon-key alias), `VITE_ADMAS_LLM_URL`, and `VITE_ADMAS_LLM_KEY`.

Inference sends a fresh **app-user** Supabase access token as Bearer authentication and the public routing key separately in `x-admas-project-key`. Tokens refresh after 12 minutes, before the gateway's 15-minute freshness limit. Neither a platform-owner session nor a routing key can substitute for an app-user token. Inference requires an active connected app backend and an exact approved HTTPS origin.

AI output has a strict five-field schema. Extra price, approval, and payment fields are rejected. Unsupported material or dimensions remain unresolved. When AI is unavailable, the app labels the local helper draft and requires review.

## Storage and payment integrity

The server atomically persists quotes, catalog, settings, and payment attempts in `/data/state.json` using a temporary file, fsync, and rename. The root data directory, private environment files, and launcher runtime files are excluded from source distributions.

PayPal OAuth and Orders v2 calls are server-side and Sandbox-only. Order amounts are bound to the approved quote version. Capture checks validate the order, merchant, currency, exact cents, and child capture before the canonical quote becomes paid. Pending or uncertain capture attempts remain recoverable and block conflicting revisions. Duplicate callbacks and retries reuse the existing attempt. The browser announces a receipt only after refreshing the same canonical paid quote and order.

This is a single-owner hackathon demo. The business/customer view switch demonstrates the workflow; it is not a production multi-tenant authorization system. Use synthetic customer information. The Admas frontend provides authenticated AI and connects to the standalone Node server for quote persistence and payments. A plain preview without its private launcher connection shows sample data and disables payments. Each reviewer needs a running server and privately supplied Sandbox credentials, or private access to a maintained demo. Keep test access available through December 15, 2026 for judging.

## Validation and outstanding live evidence

```sh
npm test
npm run build
npm run lint
# Disposable checkout only:
npm run test:server
```

Run `test:server` only in a disposable copy: it writes synthetic test data and replaces provider calls with fakes. The reviewed release has **25 pricing, AI/auth, access, private-transport and launcher checks**, **18 checkout lifecycle/recovery checks**, and **16 fake-provider backend regressions**. The production build passes. Lint completes with existing warnings; the checkout tests do not replace a real browser or PayPal transaction. The ten transport checks cover exact-origin CORS, preflight, missing/wrong tokens, local compatibility, fragment handling, and preventing app-user Authorization from reaching the payment server.

A live application check verified an authenticated AdmasLLM request: OpenAI fast, 240 provider tokens, 1 credit charged, and the expected 48-inch oak/two-drawer/delivery draft at $1,130. The owner's HTTPS Node runner has also opened the genuine PayPal Sandbox approval page. That page rendered blank in the observed browser, and no buyer approval/capture has been verified.

Before contest submission, capture a genuine Sandbox buyer approval/capture and attach the required public demo video. Real AI extraction is verified; no completed PayPal transaction or contest submission is claimed by this package.

## Provider references

- PayPal Orders v2: <https://developer.paypal.com/docs/api/orders/v2/>
- PayPal Sandbox: <https://developer.paypal.com/tools/sandbox/>
- Supabase email sign-in: <https://supabase.com/docs/guides/auth/auth-email-passwordless>
- Cloudflare Quick Tunnels: <https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/>
- Pinned Cloudflare release and checksums: <https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7>
