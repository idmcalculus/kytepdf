# KytePDF Auth Server

This is the standalone authentication server for KytePDF, powered by `@fortressauth/server`.

## Development

1. Copy `.env.example` to `.env`.
2. Run `npm install`
3. Run `npm run dev`

The server uses a local SQLite database for development (`./local.db`). Run this service with Node, not Bun: `@fortressauth/server` currently uses `better-sqlite3`, which Bun cannot load.

**Tip:** You can also manage the auth server from the project root:

```bash
bun run auth-server:install   # npm install --prefix auth-server
bun run auth-server:dev       # start in watch mode
```

## Production Deployment

### Required Environment Variables

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/dbname` | PostgreSQL connection string |
| `COOKIE_SECURE` | `true` | Must be `true` in production (HTTPS) |
| `COOKIE_SAMESITE` | `none` | Use `none` for cross-origin; `lax` for same-site |
| `CSRF_COOKIE_SECURE` | `true` | Must be `true` in production |
| `CSRF_COOKIE_SAMESITE` | `none` | Match `COOKIE_SAMESITE` |
| `BASE_URL` | `https://kytepdf.com` | Frontend URL for email links |
| `CORS_ORIGINS` | `https://kytepdf.com` | Comma-separated allowed origins |
| `EMAIL_PROVIDER` | `resend` | `resend` for production email, `console` for dev logging |
| `RESEND_API_KEY` | `re_...` | Required when `EMAIL_PROVIDER=resend` |
| `EMAIL_FROM_ADDRESS` | `noreply@kytepdf.com` | Sender address for emails (required when `EMAIL_PROVIDER=resend`) |

### OAuth (Optional)

OAuth buttons are only shown in the frontend when `VITE_AUTH_OAUTH_PROVIDERS` is set (see below). On the server side, configure:

| Variable | Notes |
|---|---|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://auth.kytepdf.com/auth/oauth/google/callback` |
| `GITHUB_CLIENT_ID` | From GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | From GitHub Developer Settings |
| `GITHUB_REDIRECT_URI` | `https://auth.kytepdf.com/auth/oauth/github/callback` |

## Frontend Configuration

The KytePDF frontend requires these Vite build-time env vars:

| Variable | Example | Notes |
|---|---|---|
| `VITE_AUTH_API_URL` | `https://auth.kytepdf.com` | **Required in production.** If unset, auth UI shows "unavailable". |
| `VITE_AUTH_OAUTH_PROVIDERS` | `google,github` | Comma-separated. Only listed providers show buttons. Empty = no OAuth UI. |

### Content Security Policy

The `netlify.toml` `connect-src` directive must allow the auth API domain:

```
connect-src 'self' https://auth.kytepdf.com;
```

### Cookie / Domain Requirements

- The auth server must set cookies with `Domain=.kytepdf.com` (or your shared root domain) so that the frontend at `kytepdf.com` can send them.
- `SameSite=None; Secure` is required for cross-origin cookie delivery.
- Alternatively, deploy the auth server on the same origin (e.g. `kytepdf.com/api/auth`) and use `SameSite=Lax`.
