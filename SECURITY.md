# Security Policy

## Scope

SAMI COINS contains an administrative API and stores customer order data, including encrypted EA credentials and payout information. Security changes must preserve the server-authoritative trust boundary.

## Security requirements

- Firebase ID tokens are verified server-side.
- Admin authorization is enforced by the backend.
- Firestore client writes are disabled for protected collections.
- Sensitive EA and payout fields are encrypted at rest.
- Sensitive decryption is restricted to explicitly configured admin identities and rate-limited.
- Sensitive API responses use `Cache-Control: no-store`.
- Security-sensitive mutations are server-audited.
- API request bodies are size-limited and API traffic is rate-limited.
- Production secrets must never be committed to Git.
- The public deployment must use HTTPS.

## Production configuration

Set the following values outside Git:

- `ENCRYPTION_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `DECRYPT_ADMIN_EMAILS` or, preferably, `DECRYPT_ADMIN_UIDS`
- `ALLOWED_ORIGINS`
- `ENABLE_HSTS=true`
- `TRUST_PROXY` when running behind a trusted reverse proxy

The VPS-only Firebase service account file must remain outside Git and must have restrictive filesystem permissions.

## Reporting

Do not publish credentials, customer data, EA credentials, backup codes, payment details, or exploit details containing real secrets in public issues. Report security problems privately to the repository owner.
