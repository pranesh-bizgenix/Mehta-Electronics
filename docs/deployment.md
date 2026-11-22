# Combined CRM deployment

Deploy the repository root using `Dockerfile.vercel`. It runs the existing Node server and Next.js UI on one listener; APIs remain relative `/api/...`. `vercel.json` selects Sydney, near the existing authorized RDS database. The container includes Python and the existing pypdf helper for price-list PDF inspection.

Required private runtime settings: `DATABASE_URL` (existing authorized RDS URL with TLS), `APP_ENCRYPTION_KEY` (existing key; do not rotate), `PORT=3000`, `HOST=0.0.0.0`, `MFA_ENABLED=true`, `LOCAL_REVIEW_ACCESS=false`, `SCHEDULER_ENABLED=false`, `EMAIL_AUTOMATION_ENABLED=false`. Supply secrets through the hosting environment, never source files or build arguments. The image runs as the unprivileged `node` user.

Production authentication requires the existing staff password and, for roles requiring it, authenticator enrollment or verification. Deployment does not create users, reset passwords or grant permissions.

`.vercelignore` excludes secrets, backups, generated output, reference documents, QA files and connector code. `.dockerignore` separately limits the image context. Only the existing PDF helper is included from root scripts. No migration, business rule or connector implementation is changed.

## Deployment commands

Run `npx vercel@66.6.0 deploy --dry --format=json` to review every uploaded source path. Run `npx vercel@66.6.0 deploy --yes --target preview` for a protected preview. For release, use `npx vercel@66.6.0 deploy --yes --prod --skip-domain`, verify it, then `npx vercel@66.6.0 promote <deployment-url> --yes`.

The current Vercel identity cannot link the GitHub repository automatically. CLI deployment works independently; automatic deployments on Git pushes require repository access for the Vercel GitHub integration.

## Operational limits

Container instances scale down when idle. Scheduled/background work is not certified by this deployment; the scheduler remains disabled. Live Tally connector reachability and long-running imports require separate validation. No connector configuration is changed. Email automation remains hidden and returns 404 while its flag is off.

Existing startup migration checks, including the verified-backup freshness guard, still apply. If a future deployment has pending migrations, stop and follow the approved database migration procedure. This deployment does not run the local-only backup script against RDS.

Verify `/api/health`, `/login`, the brand image and icon, anonymous CRM API denial, disabled automation 404s and required MFA before releasing. Deployment readiness is not evidence that every business workflow has been manually tested.
