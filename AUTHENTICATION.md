# Native authentication

## Configuration

Production frontend: `https://trade-client-frontend.vercel.app`.
Production backend: `https://trade-client-app.vercel.app`.
API base: `https://trade-client-app.vercel.app/api/v1`.

For the frontend Vercel project, set `API_BACKEND_URL` to the API base above and
redeploy. For the backend project, set `AUTH_FRONTEND_URL` and `CORS_ORIGIN` to the
frontend origin, set `NODE_ENV=production`, and configure the private database,
SMTP, JWT signing, and existing TOTP encryption keys. Non-secret production URLs
are also declared in each project's `vercel.json`. Check project-level overrides
for stale localhost or previous-backend values. Updating local files does not
update Vercel project settings or deploy the application.

Both backend entry points use `configureHttp`, so production uses the same API
prefix, validation, cookie/CSRF-compatible CORS, and no-store headers as local
development. The Vercel entry point shares initialization across concurrent
requests and returns a generic 503 on startup failure, without exposing secrets.
Check its TypeScript with `npx tsc -p tsconfig.vercel.json` and, after building,
run `node test/production-auth.smoke.cjs`. This change does not modify inventory
or account synchronization.

For local development, run `npm run dev` from the frontend folder to start both
apps, or `npm run start:local` / `npm run start:dev` from the backend folder when
running them separately. Both backend development commands use port 4050,
localhost origins, and HTTP-compatible development cookies without editing the
production `.env`. Keep the development terminal open. The frontend's
`npm run dev:frontend` command starts only Next.js and requires a separate backend.
The local backend runs TypeScript's watcher and the API as separately supervised
Node processes. Successful builds restart the API serially; compile errors keep
the last working API running, and unexpected API exits trigger a restart. This
avoids Nest CLI's Windows `taskkill` race. Check it with
`node test/local-supervisor.smoke.cjs`.

Set these on the backend host, including production (local `.env` is not deployed):

- `AUTH_JWT_SECRET`: private random signing key of at least 32 bytes.
- `AUTH_TOTP_ENCRYPTION_KEY`: independent 32-byte key encoded as 64 hexadecimal
  characters. Keep it private, back it up, and retain it across deployments and JWT
  key rotations. Changing this key without re-encrypting stored secrets prevents
  enrolled users from using their authenticator apps.
- `AUTH_FRONTEND_URL`: frontend origin, currently `https://trade-client-frontend.vercel.app`.
- `AUTH_EMAIL_FROM`: sender email authorized by your SMTP provider.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD` (or `SMTP_PASS`).

SMTP uses TLS on port 465 and requires STARTTLS on other ports. Missing email
configuration blocks new registration and account email requests rather than
returning an unusable link. Passwords, email tokens, and SMTP credentials are never
returned in API responses. Email tokens are stored only as SHA-256 digests.

## Account flow

1. Registration creates an unverified account and emails a 24-hour verification link.
2. Users explicitly confirm verification on the linked frontend page, then sign in.
3. The sign-in page has one **Set up or recover your account** action. Users enter
   their email and receive a 30-minute, single-use password-setup link.
4. Completing that link saves the password and verifies the email together,
   invalidates existing sessions and obsolete verification links, and preserves
   roles and enabled 2FA. It does not automatically sign the user in.
5. Account email requests have a one-minute resend cooldown and return the same
   generic response for known and unknown accounts.

If initial delivery fails after registration, the account remains registered. Use
the combined account setup action after correcting delivery settings. Existing emails stay
reserved; no registration overwrites existing profiles or roles. Existing accounts
can establish a local password and verify their email with the same recovery link.

The primary recovery entry point is `/auth/recover-account`. The older request
routes `/auth/resend-verification` and `/auth/forgot-password` use the same flow.
Signup emails still use `/auth/verify-email`; setup emails use `/auth/reset-password`.
Email tokens use URL fragments
and are removed from the address bar after the page loads. Deploy both the backend
and frontend changes together for emailed links to work.

## Validation

Build the backend with `npm run build`, then run:

```
node test/native-auth.smoke.cjs
node test/account-recovery.smoke.cjs
node test/auth-cookies.smoke.cjs
node test/auth-rate-limit.smoke.cjs
node test/auth-mfa.smoke.cjs
```

After building, `npm run test:auth` runs all five standalone authentication checks.

These checks use mocked persistence and SMTP; they do not send email or change
live accounts. The existing Jest configuration has a NestJS ESM compatibility
issue. Frontend types can be checked with `npx tsc --noEmit` in the frontend project.

## Authentication rate limits

Authentication endpoints use atomic MongoDB counters shared by all backend
workers. Counters expire automatically; the window identifier ensures a new
window works even before MongoDB's background cleanup runs. Stored keys are
HMAC digests, so rate records contain no plaintext email addresses or IPs.

- Login: 10 attempts per email and 300 per network address every 15 minutes.
- Registration: 3 per email and 100 per network address per hour.
- Password recovery and the legacy verification-resend endpoint share one limit:
  5 per email and 100 per network address per hour.
- Verification, password reset, TOTP verification, and TOTP confirmation: 100 per
  network address every 15 minutes. Disabling TOTP is limited to 30 per network
  address every 15 minutes.
- Refresh: 1,000 per network address every 15 minutes.
- TOTP enrollment and administrator account provisioning: 100 per network address
  per hour.

All attempts count, including successful requests. Email limits normalize case
and surrounding whitespace and apply equally to known and unknown accounts.
IPv4-mapped IPv6 addresses share IPv4 buckets; IPv6 privacy addresses share their
/64 network bucket. Limits use fixed windows, so attempts reset at window boundaries.
Blocked requests return HTTP 429, an `AUTH_RATE_LIMITED` code, `retryAfterSeconds`,
and a `Retry-After` header. A counter-store outage returns 503 rather than bypassing
protection. CSRF initialization, session lookup, and logout remain available.

Set `TRUSTED_PROXY_CIDRS` to a comma-separated list of actual proxy source addresses
or networks under your control. The default `loopback` supports a reverse proxy
on the same host. Never trust all addresses or an arbitrary proxy-hop count.
Untrusted `X-Forwarded-For` headers cannot override the network identity.
With the Vercel rewrite, users can share the Vercel proxy's network bucket unless
the full proxy chain is configured correctly. Check this against production
infrastructure before deployment; do not guess proxy networks. Email limits remain
separate regardless of proxy configuration.

## Authenticator 2FA

Use the profile menu's **Manage 2FA** action. Starting setup requires the current
password. Scan the locally generated QR code or enter the manual setup key, then
confirm a six-digit code. Pending setup expires after 10 minutes and allows five
confirmation attempts. Starting new setup invalidates the previous pending setup.
2FA is not enabled until confirmation succeeds.

Successful confirmation returns ten recovery codes once, with a download option.
The application stores only their hashes. Each code is single-use and can replace
an authenticator code at login or when disabling 2FA. To replace recovery codes,
disable 2FA using the current password and a valid code, then enroll again.

Password login for an enrolled user returns a random challenge, not a session.
Challenges are bound to the user, password version, and MFA version, expire after
five minutes, and allow at most five attempts. TOTP supports a one-step clock skew
in either direction. An accepted time step cannot be reused, including the code
used to confirm enrollment; wait for the next code when necessary. Challenge
consumption and code consumption are atomic. The implementation is checked against
[RFC 6238 Appendix B](https://www.rfc-editor.org/rfc/rfc6238#appendix-B).

Authenticator secrets are encrypted with AES-256-GCM and associated with the user
identity. Setup secrets, verification codes, recovery codes, and login challenges
are not included in audit logs. Changes to MFA invalidate older sessions and issue
a new session for the device that completed the change. Password resets preserve
enabled 2FA, invalidate pending setup and existing sessions, and invalidate older
login challenges. Keep the backend clock synchronized.

If both the authenticator and all recovery codes are lost, email password recovery
does not remove 2FA. A separate administrator identity-verification and recovery
process is needed; there is no automatic bypass endpoint.

## Remaining migration work

Deployment validation and retiring unused Supabase dependencies remain separate
steps. Sessions use HttpOnly cookies with Secure enabled in production and
SameSite=Lax. The frontend proxies `/api/v1` to the backend to keep cookies
first-party. Access and refresh credentials are not returned in browser JSON.
Mutations require a signed, expiring CSRF token matching the HttpOnly CSRF cookie;
explicit origins are checked against `AUTH_FRONTEND_URL` and `CORS_ORIGIN`.
Set `API_BACKEND_URL` on the frontend host to the backend URL including `/api/v1`.
Rebuild and deploy both apps together. Existing bearer sessions require signing
in again. For local HTTP development set backend `NODE_ENV=development` and
include the local frontend origin in the backend configuration.
