# Email: invitations and password resets

The app sends three kinds of email, all optional: an **invitation** (a new person sets
their name and password through a link, valid 7 days), a **password-reset link** (valid
1 hour, the other sessions end) and a **test email** from Setări. Without email the app runs
exactly as before: the owner hands over a temporary password through the copy / share card.

Mail goes out through [Resend](https://resend.com) over its HTTP API (`lib/email.js`, no SDK).
Nothing in the live path depends on it: the projector, setlists and live control work
offline and on a local server whether or not a key is set.

## 1. Resend account

1. Create an account at resend.com and add an **API key** (Resend → API Keys → Create).
   Give it *sending access* only. Copy it once: it starts with `re_`.
2. Add the sending **domain** (Resend → Domains → Add domain), e.g. `sanctuaryvoice.com`.
   A subdomain such as `mail.sanctuaryvoice.com` also works and keeps the root domain's
   mail settings untouched.

## 2. DNS: SPF and DKIM

Resend shows the exact records to add for the domain; copy them as displayed there (the
values are per account, so this guide does not list them). They are:

| Type | Host (as Resend shows) | Purpose |
| --- | --- | --- |
| TXT | `send` (or the subdomain) | SPF: `v=spf1 include:amazonses.com ~all` |
| MX | `send` | the return path for bounces |
| TXT | `resend._domainkey` | DKIM: the public key Resend generates |

Add them at the registrar / DNS provider of `sanctuaryvoice.com`, then press **Verify** in
Resend. Verification usually takes minutes, sometimes up to a day. Until the domain is
verified Resend refuses to send from it (the app then reports `emailFailed`).

Optional: a `DMARC` TXT record on `_dmarc.sanctuaryvoice.com` (`v=DMARC1; p=none;`) helps
delivery to Gmail / Outlook.

## 3. Environment variables

| Variable | Required | Example | Meaning |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | yes | `re_…` | the API key; without it email is off |
| `EMAIL_FROM` | yes | `Worship App <noreply@sanctuaryvoice.com>` | the sender, on the verified domain |
| `EMAIL_REPLY_TO` | no | `adrian@sanctuaryvoice.com` | where replies go |
| `EMAIL_API_URL` | no | | tests only: a local stand-in for `https://api.resend.com/emails` |
| `PUBLIC_BASE_URL` | recommended | `https://app.sanctuaryvoice.com` | the address in the links; otherwise the request's host |

On Render both keys are declared in `render.yaml` with `sync: false`: set them in the
service's **Environment** tab and redeploy. Locally put them in `.env`. Email is enabled
only when **both** `RESEND_API_KEY` and `EMAIL_FROM` are set; the startup log says
`Email: enabled (from …)` or `Email: disabled`.

## 4. Check it works

Setări (owner) → **Email**. The card shows *activ (adresa)* or *dezactivat*, and, when
enabled, **Trimite un email de test** sends a test message to the owner's own address.
Then on Echipa → **+ Adaugă persoană** the primary action is *Trimite invitația pe email*;
every person who never signed in has *Retrimite invitația*, and everyone has *Trimite link
de resetare*. The login page gains *Ai uitat parola?*.

## 5. Limits and behaviour

- **20 emails an hour per church** (`PER_ADMIN_PER_HOUR` in `lib/email.js`); beyond it the
  actions answer `429 emailRateLimited`.
- **"Ai uitat parola?": 5 requests an hour per email and per IP**, and always the same
  answer whether the account exists or not.
- A Resend 5xx or a network error is retried once; a 4xx (e.g. an unverified domain) is not.
- Tokens are 32 random bytes; only their SHA-256 is stored (`user_tokens`). A new link of
  the same kind spends the older one. Links are single use.
- The log records `Email "invite" sent to …` but never a token or a link.
- Emails are in the recipient's saved language, else the language of the request.
- The Resend free tier (as of 2026) allows 100 emails a day and 3 000 a month from one
  verified domain; check the current numbers on resend.com/pricing.

## Without a key

Leave both variables unset (local mode, or a church without a domain). Buttons that need
email are hidden, `POST /api/team/:id/invite`, `/reset-link` and `/api/auth/forgot` answer
`503 emailDisabled`, and the login page has no reset link.
