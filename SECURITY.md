# Security operations

No internet-facing system can honestly be guaranteed risk-free. This project uses defense in depth, but it is secure in production only when the application, Supabase project, hosting platform, administrator devices, and operating procedures are all configured and maintained correctly.

## Controls implemented in the repository

- Row Level Security and permission checks protect every application table.
- Member accounts are limited to their linked member record and targeted portal data.
- Active accounts are authorized through database-enforced roles and permissions after email/password authentication.
- User administration runs in a JWT-protected Edge Function, requires `users.manage`, rejects untrusted browser origins, and never exposes the service-role key to the browser.
- Anonymous database access and default anonymous privileges are revoked.
- Security-sensitive changes are written to an append-only audit table; direct client inserts are denied and client-reported events are labelled and rate-limited.
- New and reset passwords require at least 12 characters with uppercase, lowercase, a number, and a symbol.
- Sessions are configured for a 12-hour maximum and a 30-minute inactivity timeout.
- Browser scripts are pinned locally. CSP, anti-framing, MIME-sniffing, referrer, permissions, HTTPS, and cache headers are supplied in `_headers`.
- Runtime replacement of the Supabase project URL/key is disabled, and CSV exports neutralize spreadsheet formulas.

## Required production activation

Complete these steps in a maintenance window.

1. Back up the Supabase database and confirm that a restore is possible.
2. Set the production Site URL and only the exact required redirect URLs in Supabase Authentication. Disable public and email sign-up.
3. Mirror the repository Auth settings in the hosted Supabase project: 12-character complex passwords, email confirmation, secure password changes, refresh-token rotation, a maximum of 10 sign-in/sign-up attempts per IP every five minutes, a 12-hour session timebox, and a 30-minute inactivity timeout. Disable TOTP enrollment and verification. Enable leaked-password protection if the project plan supports it.
4. Apply all migrations, including `20260829000000_remove_mfa_requirement.sql`:

   ```powershell
   npx supabase db push
   ```

5. Allow only the exact production application origin for account management, then deploy the function:

   ```powershell
   npx supabase secrets set ALLOWED_ORIGINS=https://your-exact-production-domain.example
   npx supabase functions deploy manage-users
   ```

   Do not include a trailing slash. Use a comma-separated list only when multiple origins are genuinely required.

6. Deploy through HTTPS on a host that supports the included `_headers` file. If the host does not support it, reproduce every header in the host's native configuration; do not rely only on the CSP meta tag.
7. Review privileged accounts immediately. The historical initial role migration promoted Auth users that existed at that time to Super Administrator:

   ```sql
   select p.email, p.status, r.name, r.permissions
   from public.user_profiles p
   join public.app_roles r on r.id = p.role_id
   where 'roles.manage' = any(r.permissions)
   order by p.email;
   ```

   Remove unexpected access, deactivate unused accounts, use named accounts only, and keep a separately protected recovery administrator rather than sharing credentials.

8. Confirm from a private browser session that anonymous API reads fail, Member accounts cannot read another member's records, inactive accounts are rejected, and administrators receive only their assigned permissions.

## Ongoing operations

- Review `security_audit_log`, Supabase Auth audit logs, and Edge Function logs regularly; alert on repeated failed sign-ins, role changes, user deletions, and administrator password resets.
- Apply browser, dependency, Supabase, and operating-system security updates promptly. Re-download pinned browser libraries only from their official release sources and review the diff/hash.
- Revalidate RLS whenever a table, view, RPC, role, or permission is added. New public-schema objects must not be granted to `anon`.
- Test backups and account-recovery procedures on a schedule. Remove access immediately when an administrator leaves or changes responsibility.
- Never place the Supabase service-role key, database password, or SMTP credentials in this repository or browser storage. The publishable browser key in `config.js` is not a secret; RLS is the authorization boundary.
- Serve administrator access only from managed, encrypted, patched devices. Password managers and phishing-resistant device controls are strongly recommended.

## Incident response

If compromise is suspected, take the application offline or block the affected origin, deactivate the account, revoke its sessions, rotate exposed secrets, preserve audit logs, review role/data changes, restore only when integrity is established, and notify affected people as required by applicable policy or law.
