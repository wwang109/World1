# Account sign-in setup

Scope: provider configuration and deployment checks for Google, GitHub, Steam, and email sign-in. The shared account service in `src/meta/account.ts` owns behavior; `docs/architecture.md` owns account-service topology and persistence.

## Runtime configuration

Set these on the Pages Functions environment being deployed. Configure production and preview independently. Keep email credentials in server-side secrets, never `VITE_*` variables or tracked files.

| Name | Purpose |
|---|---|
| `GHOSTS_DB` | Existing D1 account/run/community database binding. |
| `GOOGLE_CLIENT_ID` | Public OAuth web application client id for Google Identity Services. |
| `GITHUB_OAUTH_CLIENT_ID` | Client id for the dedicated GitHub sign-in OAuth app. |
| `GITHUB_OAUTH_CLIENT_SECRET` | Server-only secret for that GitHub sign-in OAuth app. |
| `EMAIL_FROM` | Sender address on a Cloudflare Email Service sending domain. |
| `EMAIL_ACCOUNT_ID` | Cloudflare account that owns the sending domain. |
| `EMAIL_API_TOKEN` | Server-only API token permitted to send email for that account. |

`GOOGLE_CLIENT_ID` is public configuration, not a client secret. This implementation uses Google's popup ID-token flow and does not require a Google client secret.

## Google

Create or reuse a Google Cloud OAuth client of type **Web application**, with Wandering Hand branding. Add the game's exact public origin to **Authorized JavaScript origins**, including its scheme and port where applicable. Add custom-domain and preview origins separately if they should support sign-in. For local work, authorize `http://localhost` and the actual Vite origin, such as `http://localhost:5182`.

Set the resulting client id as `GOOGLE_CLIENT_ID` on the API runtime. The official Google button loads only when the player opens Google sign-in. The popup returns an ID token to the game; the server verifies it against Google's signing keys, the configured audience, and the account's short-lived nonce challenge. There is no application OAuth redirect route to register for this popup flow.

If the deployment enforces Content Security Policy or Cross-Origin-Opener-Policy, allow the Google Identity Services resources and its popup flow according to [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Google branding, test-user restrictions, and publishing status must permit the intended testers.

Provider verification: [Google ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## GitHub

Register a dedicated **Wandering Hand sign-in** OAuth app. Use the game URL as its homepage and register the exact API callback URL, such as `https://<game-host>/account/github/callback`. For local development, use the API origin, for example `http://127.0.0.1:8787/account/github/callback`; the game may still run on Vite port 5182. Configure each intended deployment origin explicitly and keep wildcard callback matching disabled.

Set `GITHUB_OAUTH_CLIENT_ID` and the server-only secret `GITHUB_OAUTH_CLIENT_SECRET` together on the API runtime. This is independent of the community merger's GitHub App, installation tokens, and repository permissions. Do not reuse those credentials for player sign-in.

The flow requests no repository, private-email, organization, or write scopes. The server exchanges the code using S256 PKCE and reads only the authenticated user's stable numeric id from `/user`. Provider access tokens remain temporary on the server; the browser receives only the game's short-lived handoff code. Account linking completes when that handoff is redeemed in the game.

Configuration does not prove live consent and callback handling. Test an authorized app against the exact registered origin before enabling GitHub for players. References: [registering an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [authorization flow and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

## Steam

The existing Steam website OpenID flow needs no Steam Web API key. The player returns to the same game origin and redeems a short-lived handoff code. A website login proves the Steam identity; it does not prove game ownership.

Provider reference: [Steam website authentication](https://partner.steamgames.com/doc/features/auth#website).

## Email on Pages

Enable Cloudflare Email Service sending for a domain owned by the deployment account and finish its DNS/domain setup. Configure `EMAIL_FROM`, `EMAIL_ACCOUNT_ID`, and the secret `EMAIL_API_TOKEN` together. Email sign-in uses a one-time link, so the game stores no email password.

Pages Functions support a subset of Workers bindings and do not list a native `send_email` binding. The Pages adapter therefore uses the [Cloudflare Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). An actual Workers runtime may instead provide the existing native `EMAIL` send binding with `EMAIL_FROM`; that path accepts Cloudflare's structured email builder.

Email availability means the sender configuration is present. It does not prove that a sending domain, token, entitlement, or mailbox delivery works. Confirm a real message reaches a test mailbox before treating email as live. Missing configuration must remain visible as an unavailable provider in the account UI.

References: [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [Email Service domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/), [Workers email binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

## Development and release checks

`npm run api` reads process environment variables. For a local email preview, set `ACCOUNT_EMAIL_PREVIEW=true`; the service writes the message to the ignored `.tmp/account-email-preview.json` file instead of sending it. `ACCOUNT_EMAIL_PREVIEW_FILE` can point to an isolated audit location. Those links are authentication credentials; keep the preview private and do not include links in shared screenshots or audit reports.

- Run `node node_modules/tsx/dist/cli.mjs scripts/account-sign-in-audit.ts` and `npm test` before publication. The focused audit uses isolated file/SQLite stores and native signed-token fixtures; it does not contact providers or send email.
- Inspect the account panel and email/Google dialogs at `/?ui=desktop` in 1440x900 and `/?ui=mobile` in 412x892 viewports.
- Verify missing-provider configuration, dismissed Google dialog, invalid/expired links, account switching, and sign-out.
- Test real Google sign-in against an authorized origin, GitHub consent/callback, real Steam return, and delivered email independently of local fixtures.
- Link a fresh guest account and confirm its online run and vote wallet remain under the same account id. Complete a new email/GitHub/Steam link in the browser that started it to preserve that guest account. A new identity opened elsewhere creates a fresh account; an already-linked identity recovers its existing account. Accounts are not merged.
- Practice saves and lifetime statistics remain browser-local. Provider sign-in does not turn those into cloud saves.

No cloud configuration, email send, or live provider authentication is implied by a passing local audit.
