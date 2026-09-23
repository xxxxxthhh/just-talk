# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
"Report a vulnerability" (Security Advisories) on this repository instead of
opening a public issue. Include steps to reproduce and the impact you expect.

## Deployment notes

- The personal/local mode has **no authentication**. Bind it to `127.0.0.1`,
  or reach it only through a private network such as Tailscale.
- Only the public trial mode (`PUBLIC_MODE=1`, see
  [docs/deploy-public.md](docs/deploy-public.md)) is designed to face the
  internet. It uses anonymous visitors, per-visitor data files, persistent
  usage caps, request size limits, and Origin checks.
- The public caps bound *usage recorded by the app*. They are not a
  guarantee on the provider bill. Also set an Azure budget alert. Budgets
  only notify you; they do not stop spending.
- Never commit `.env` files, tunnel credentials, or SQLite data.
