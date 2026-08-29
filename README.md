# Recovery Agent

An AI agent that detects failed subscription/payment webhooks from Razorpay,
classifies the root cause, decides a bounded recovery action using Claude,
executes it, and logs every decision to an audit trail.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - Razorpay test-mode key ID, secret, and webhook secret
   - Your Anthropic API key
   - A Neon (or any) Postgres connection string
3. `npm start` — this creates the schema automatically and starts the server + retry cron.
4. In a second terminal: `ngrok http 3000`, then register the ngrok HTTPS URL + `/webhook`
   in Razorpay Dashboard → Settings → Webhooks, subscribed to `payment.failed` and
   `subscription.charged.failed`.
5. Seed synthetic data: `npm run seed` (defaults to 40 records; pass a number to change it,
   e.g. `node seed.js 60`). This posts correctly-signed fake webhook payloads straight at
   your own `/webhook` endpoint, so you don't need to drive 40 real checkouts through
   Razorpay's test cards.
6. Open `http://localhost:3000/dashboard.html` to watch it process live.

## Deploying

1. Push this repo to GitHub.
2. Create a Neon project (free tier), copy its connection string into `DATABASE_URL`.
3. Create a Railway project, connect the GitHub repo, add all `.env` values as
   Railway environment variables (set `BASE_URL` to the Railway-assigned public URL).
4. Update the Razorpay webhook URL to point at your Railway URL + `/webhook`.
5. Re-run `node seed.js` with `BASE_URL` pointed at the deployed URL to confirm everything
   works end-to-end in production before demo day.

## Key endpoints

- `POST /webhook` — Razorpay calls this on payment/subscription failure events.
- `GET /metrics` — recovery rate, amount recovered, escalations, still-pending count.
- `GET /customers` — list of all customers with their latest action/outcome.
- `GET /audit/:customerId` — full decision history + LLM reasoning for one customer.
- `POST /reset-demo` — wipes all data so you can re-run a clean demo.

## Guardrails already built in

- Webhook HMAC signature verification (rejects unverified events).
- Idempotency on `razorpay_event_id` (duplicate webhook deliveries are skipped).
- Fixed 5-action menu the LLM must choose from — invalid output is rejected server-side.
- Hard cap of 3 retry attempts before forced escalation.
- Non-retryable failure reasons (expired/invalid card) can never be retried, even if the
  model suggests it — enforced in code, not just prompted.
