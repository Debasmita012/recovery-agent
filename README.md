# ✨ Shimmer — AI Payment Recovery & Gating Intelligence

> **AI proposes. Rules dispose. Revenue recovers.**

**Razorpay Buildathon 2026 — Track 03: AI Revenue Recovery**

Shimmer is an AI-powered payment recovery engine that detects failed payments, understands why they failed, recommends the best recovery action, applies deterministic safety rules, and records every decision in an auditable trail.

For the current demonstration, Shimmer uses **Razorpay Test Mode** for safe payment and webhook testing without charging real money.

---

## 🔗 Links

- **Live Demo:** https://recovery-agent-go6k.onrender.com/
- **Test Payment:** https://recovery-agent-go6k.onrender.com/test-payment
- **GitHub:** https://github.com/Debasmita012/recovery-agent

---

# 🎯 The Problem

Failed payments cause revenue leakage and involuntary customer churn.

A basic system simply retries every failure:

```text
Payment Failed
      ↓
Retry
      ↓
Retry Again
      ↓
Give Up
```

But different failures require different actions:

- **Insufficient funds** → retry later
- **Bank declined** → controlled retry
- **Expired card** → do not retry
- **Invalid card** → customer intervention

The real question is:

> **"What is the safest and most economically valuable next action?"**

---

# 💡 The Solution

Shimmer converts payment failures into an intelligent recovery workflow:

```text
Payment Event
      ↓
Webhook Verification
      ↓
Idempotency Check
      ↓
Failure Classification
      ↓
AI Decision Engine
      ↓
Safety Gate
      ↓
Retry / Schedule / Escalate
      ↓
Audit Trail
      ↓
Dashboard
```

Supported actions:

| Action | Purpose |
|---|---|
| `retry_now` | Retry immediately |
| `retry_in_24h` | Retry later |
| `send_discount_offer` | Controlled incentive |
| `escalate_human` | Human intervention |
| `give_up` | Stop recovery |

---

# 🧠 Core Innovation

## AI proposes. Rules dispose.

AI recommends the action, but deterministic rules control what is actually allowed.

```text
AI Recommendation
        ↓
   Safety Gate
        ↓
 ┌─────────────────┐
 │ Max 3 attempts  │
 │ Retryability    │
 │ Discount ≤ 10% │
 └────────┬────────┘
          ↓
     Allowed Action
```

If AI is unavailable, Shimmer uses deterministic fallback policies.

---

# 🔍 Failure Intelligence

| Failure | Retryable | Response |
|---|---:|---|
| `insufficient_funds` | ✅ | Retry later |
| `bank_declined` | ✅ | Controlled retry |
| `card_expired` | ❌ | Escalate |
| `invalid_card` | ❌ | Escalate |
| `unknown` | Controlled | Fallback policy |

---

# 🛡️ Safety & Explainability

Shimmer enforces:

- Maximum **3 attempts**
- Non-retryable failures cannot be retried
- Maximum discount of **10%**
- Deterministic fallback when AI is unavailable
- Webhook signature verification
- Duplicate-event protection

The audit trail records:

- Failure reason
- Selected action
- AI reasoning
- Attempt number
- Outcome
- Retry status
- Recovery amount
- Intervention cost
- Timestamp

Example:

```text
card_expired
     ↓
Non-retryable
     ↓
Retry BLOCKED
     ↓
Human Escalation
```

This lets the system explain not only **what it did**, but also **why it did not retry**.

---

# 💰 Recovery Economics

Shimmer measures business value:

```text
Net Value Created
=
Recovered Revenue
-
Intervention Cost
```

Tracked metrics include:

- Revenue at risk
- Revenue recovered
- Recovery rate
- Agent cost
- Net value created
- Average attempts

---

# 📊 Current Demo Results

| Metric | Result |
|---|---:|
| Customers processed | **40** |
| Recovered | **20** |
| Escalated / stopped | **20** |
| Revenue at risk | **₹27,960** |
| Revenue recovered | **₹13,980** |
| Recovery rate | **50%** |
| Agent cost | **₹7** |
| Net value created | **₹13,973** |
| Average attempts | **2** |

> Current recovery outcomes and intervention costs are simulated for safe, reproducible demonstrations.

---

# 💳 Razorpay Test Mode

Shimmer is connected to Razorpay Test Mode for genuine payment-provider testing.

```text
Test Payment Page
       ↓
Razorpay Checkout
       ↓
payment.failed / payment.captured
       ↓
Shimmer Webhook
       ↓
Recovery Engine
       ↓
PostgreSQL
       ↓
Dashboard
```

### Test Payment

```text
/test-payment
```

### Create Test Order

```text
POST /create-test-order
```

The server creates the Razorpay Test Mode Order before opening Checkout.

No real money is charged.

---

# 🔐 Webhook Security & Idempotency

Razorpay webhooks are verified using **HMAC SHA-256**.

Duplicate events are prevented using the Razorpay event ID:

```text
x-razorpay-event-id
```

stored as:

```text
razorpay_event_id
```

The database uses:

```sql
INSERT ... ON CONFLICT DO NOTHING
```

to safely handle repeated or concurrent webhook deliveries.

---

# 🖥️ Dashboard

The dashboard provides a near-real-time view of:

- Revenue at Risk
- Revenue Recovered
- Recovery Rate
- Recovery Funnel
- Failure Intelligence
- Agent Decisions
- Recovery Outcomes
- Live Recovery Activity
- Customer Ledger
- Audit Trail
- AI Audit Assistant

The dashboard polls the backend approximately every **6 seconds**.

Example AI audit questions:

```text
Why was cust_1001 not retried?
```

```text
Which failure reason caused the most losses?
```

```text
Summarize recent recovery performance.
```

---

# 🏗️ Architecture

```text
                    RAZORPAY
                       │
                       ▼
                Test Checkout
                       │
                       ▼
                Razorpay Webhook
                       │
                       ▼
              HMAC Verification
                       │
                       ▼
                Idempotency
                       │
                       ▼
                  Classifier
                       │
                       ▼
               AI Decision Engine
                       │
                       ▼
                Safety Gate
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
            Retry   Discount  Escalate
              │
              ▼
        Recovery Executor
              │
              ▼
          PostgreSQL
          Audit Trail
              │
              ▼
          Dashboard
```

---

# 🔄 Example Recovery

### Recoverable

```text
insufficient_funds
       ↓
retry_in_24h
       ↓
Safety Gate → ALLOWED
       ↓
Recovery
       ↓
Audit + Metrics
```

### Non-Retryable

```text
card_expired
       ↓
Retry BLOCKED
       ↓
Human Escalation
       ↓
Audit Trail
```

---

# 🗄️ Database

Shimmer uses PostgreSQL.

### Customers

```text
id
email
subscription_id
amount
```

### Events

```text
razorpay_event_id
customer_id
event_type
reason_code
action_taken
llm_reasoning
outcome
attempt_number
amount_recovered
retry_at
ruled_out_json
intervention_cost
processed
created_at
```

---

# 🔌 API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/webhook` | Razorpay webhook |
| `POST` | `/create-test-order` | Create Test Mode order |
| `GET` | `/test-payment` | Test payment page |
| `GET` | `/metrics` | Recovery metrics |
| `GET` | `/customers` | Customer states |
| `GET` | `/audit/:customerId` | Customer audit |
| `POST` | `/query-audit` | AI audit queries |
| `POST` | `/reset-demo` | Reset demo data |

---

# 🧰 Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| AI | Anthropic Claude |
| Fallback | Deterministic Decision Engine |
| Database | PostgreSQL |
| Frontend | HTML, CSS, JavaScript |
| Charts | Chart.js |
| Payments | Razorpay Test Mode |
| Security | HMAC SHA-256 |
| Deployment | Render |

---

# 📁 Project Structure

```text
recovery-agent/
│
├── server.js
├── handler.js
├── classifier.js
├── decisionEngine.js
├── executor.js
├── cron.js
├── metrics.js
├── db.js
├── schema.sql
├── seed.js
├── package.json
├── package-lock.json
├── README.md
│
└── public/
    ├── dashboard.html
    └── test-payment.html
```

---

# 🌐 Deployment

Shimmer is deployed on Render.

**Live:**  
https://recovery-agent-go6k.onrender.com/

**Test Payment:**  
https://recovery-agent-go6k.onrender.com/test-payment

**GitHub:**  
https://github.com/Debasmita012/recovery-agent

---

# ⚙️ Environment Variables

```env
PORT=3000

DATABASE_URL=your_postgresql_connection_string

ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-5

RAZORPAY_KEY_ID=your_razorpay_test_key_id
RAZORPAY_KEY_SECRET=your_razorpay_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret

PAYMENT_EXECUTION_MODE=demo
```

Never commit `.env` or expose API keys and secrets.

---

# 💻 Run Locally

```bash
git clone https://github.com/Debasmita012/recovery-agent.git
cd recovery-agent
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Test payment:

```text
http://localhost:3000/test-payment
```

---

# 🧪 Demo Flow

```text
Dashboard
    ↓
Run Razorpay Test Payment
    ↓
Create Test Order
    ↓
Razorpay Checkout
    ↓
Payment Failed
    ↓
payment.failed Webhook
    ↓
Classification
    ↓
AI Decision
    ↓
Safety Gate
    ↓
Recovery Action
    ↓
Audit Trail
    ↓
Dashboard Update
```

For a successful Test Mode payment:

```text
Razorpay Checkout
       ↓
payment.captured
       ↓
Recovered Revenue
       ↓
Audit Ledger
       ↓
Dashboard
```

---

# ⚠️ Current Prototype Limitations

Shimmer is currently a controlled buildathon prototype.

- Recovery execution runs in **demo mode**
- Recovery outcomes are simulated
- Intervention costs are simulated
- Razorpay integration uses **Test Mode**
- No real customer money is charged
- Automatic production payment retry is not currently enabled
- Dashboard uses polling rather than WebSockets
- Claude is optional because deterministic fallback is available

This keeps the demonstration safe and reproducible.

---

# 🚀 Future Improvements

- Production payment recovery execution
- Predictive recovery probability
- Adaptive retry timing
- Customer lifetime-value-aware decisions
- Multi-payment-method optimization
- Real-time WebSocket dashboard
- Recovery strategy A/B testing
- Human-support integrations
- Fraud and risk signals
- AI decision-quality monitoring
- Advanced customer segmentation
- Cost-aware recovery optimization

---

# 🏆 Why Shimmer?

Traditional recovery asks:

> **"Should we retry?"**

Shimmer asks:

> **"What is the safest and most economically valuable next action?"**

It combines:

```text
AI Reasoning
     +
Deterministic Safety
     +
Payment Events
     +
Recovery Automation
     +
Explainable Auditing
     +
Financial Measurement
```

---

# 📌 Project Summary

Shimmer is an **AI-powered revenue recovery intelligence system** for Track 03 — AI Revenue Recovery.

It:

- Detects failed payments
- Understands failure reasons
- Recommends recovery actions
- Applies financial safety rules
- Prevents duplicate webhook processing
- Records explainable decisions
- Tracks recovered revenue
- Measures recovery economics
- Provides a live operational dashboard

The current system uses genuine **Razorpay Test Mode** payment and webhook events together with controlled recovery execution.

```text
Detect
  ↓
Understand
  ↓
Decide
  ↓
Gate
  ↓
Recover
  ↓
Audit
  ↓
Measure
```

---

# ✨ Shimmer

### **AI proposes. Rules dispose. Revenue recovers.**