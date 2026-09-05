# ✨ Shimmer — AI Payment Recovery & Gating Intelligence

> **AI proposes. Rules dispose. Revenue recovers.**

**Razorpay Buildathon 2026 — Track 03: AI Revenue Recovery**

Shimmer is an autonomous AI-powered payment recovery engine for subscription SaaS businesses. Instead of blindly retrying failed payments, Shimmer understands the failure reason, uses AI to recommend the best next action, applies deterministic financial safety rules, executes or schedules the permitted action, and records every decision in an auditable trail.

### 🔗 Links

- **Live Demo:** https://recovery-agent-go6k.onrender.com/
- **GitHub:** https://github.com/Debasmita012/recovery-agent

---

## 🎯 The Problem

Failed subscription payments create involuntary churn and revenue leakage.

A simple retry system treats every failure the same:

```text
Payment Failed
      ↓
Retry
      ↓
Retry Again
      ↓
Give Up
```

But payment failures have different causes.

For example:

- **Insufficient funds** → retry later may work
- **Bank declined** → another controlled attempt may work
- **Expired card** → repeated retries are pointless
- **Invalid card** → customer intervention is required

The real question is not:

> **"Should we retry?"**

It is:

> **"What is the safest and most economically valuable next action?"**

---

# 💡 The Solution

Shimmer turns payment recovery into an autonomous decision pipeline:

```text
Payment Failure
      ↓
HMAC Verification
      ↓
Idempotency Check
      ↓
Failure Classification
      ↓
AI Decision Engine
      ↓
Deterministic Safety Gate
      ↓
Execute / Schedule / Escalate
      ↓
PostgreSQL Audit Trail
      ↓
Live Dashboard
```

The system supports five actions:

| Action | Purpose |
|---|---|
| `retry_now` | Retry immediately |
| `retry_in_24h` | Schedule a later retry |
| `send_discount_offer` | Offer a controlled incentive |
| `escalate_human` | Send to human support |
| `give_up` | Stop recovery attempts |

---

# 🧠 Core Innovation

## AI proposes. Rules dispose.

The AI recommends an action, but it cannot bypass deterministic financial safety rules.

```text
                 AI
                  ↓
          Recommended Action
                  ↓
        ┌──────────────────┐
        │   SAFETY GATE    │
        │                  │
        │ Max 3 attempts   │
        │ Retryability     │
        │ Discount ≤ 10%   │
        └────────┬─────────┘
                 ↓
          Allowed Action
                 ↓
             Executor
```

This gives Shimmer the flexibility of AI while maintaining predictable financial controls.

---

# 🔍 Failure Intelligence

Shimmer normalizes payment failures into actionable categories:

| Failure | Retryable | Typical Response |
|---|---:|---|
| `insufficient_funds` | ✅ | Retry later |
| `bank_declined` | ✅ | Controlled retry |
| `card_expired` | ❌ | Human escalation |
| `invalid_card` | ❌ | Human escalation |
| `unknown` | Controlled | Deterministic fallback |

---

# 🛡️ Safety Gates

Financial automation should never allow an LLM to make unrestricted payment decisions.

Shimmer enforces:

### Maximum retry attempts

```text
Maximum attempts = 3
```

### Non-retryable failures

```text
card_expired → retry blocked
invalid_card → retry blocked
```

### Discount protection

```text
Maximum discount = 10%
```

If an AI recommendation violates a safety rule, the rule wins.

---

# 🔎 "Why Did You NOT Retry?"

Shimmer doesn't only explain successful decisions.

It also explains **blocked decisions**.

For every recovery event, the system records:

- Failure reason
- Selected action
- AI reasoning
- Attempt number
- Outcome
- Ruled-out alternatives
- Safety-gate information
- Intervention cost
- Timestamp

Example:

```text
Customer: cust_7

Failure: card_expired

Retry: BLOCKED

Reason:
card_expired is non-retryable.

Next action:
Human escalation
```

This makes the recovery agent **auditable and explainable** rather than a black box.

---

# 💰 Recovery Economics

Shimmer measures financial value, not just the number of successful retries.

```text
Net Value Created
=
Gross Recovered Revenue
-
Intervention Costs
```

Tracked metrics include:

- Revenue at risk
- Revenue recovered
- Customer recovery rate
- Revenue recovery rate
- Agent intervention cost
- Discount cost
- Human escalation cost
- Net value created
- ROI
- Average attempts to recovery

---

# 📊 Current Demo Results

The current 40-customer demonstration produced:

| Metric | Result |
|---|---:|
| Customers processed | **40** |
| Recovered customers | **20** |
| Escalated / stopped | **20** |
| Pending | **0** |
| Revenue at risk | **₹27,960** |
| Revenue recovered | **₹13,980** |
| Customer recovery rate | **50%** |
| Revenue recovery rate | **50%** |
| Agent cost | **₹7** |
| Net value created | **₹13,973** |
| Average attempts | **2** |

### Demo outcome

```text
₹27,960 Revenue at Risk
          ↓
₹13,980 Revenue Recovered
          ↓
₹7 Agent Cost
          ↓
₹13,973 Net Value Created
```

> The current executor uses simulated payment outcomes and simulated intervention costs for safe, reproducible buildathon demonstrations.

---

# 🖥️ Dashboard

The Shimmer dashboard provides a near-real-time operational view of the recovery engine.

It includes:

### Executive KPIs

- Revenue at Risk
- Revenue Recovered
- Recovery Rate
- Net Value Created

### Recovery Intelligence

- Revenue recovery funnel
- Failure-reason breakdown
- Agent decision distribution
- Recovery outcomes

### Operations

- Live recovery activity
- Customer recovery ledger
- Customer search

### Explainability

- Complete customer audit trail
- Safety-gate breakdown
- "Why NOT Retry?" analysis

### AI Assistant

Natural-language questions over the audit trail, such as:

```text
Why was cust_1 not retried?

Why did we give up on cust_7?

Summarize recent recovery performance.
```

The dashboard polls the backend approximately every **6 seconds**, providing near-real-time monitoring.

---

# 🏗️ Architecture

```text
                    Payment Provider
                          │
                          ▼
                  ┌───────────────┐
                  │ Webhook       │
                  │ Verification  │
                  │ HMAC SHA-256  │
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │ Idempotency   │
                  │ Event ID      │
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │ Classifier    │
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │ AI Decision   │
                  │ Engine        │
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │ Safety Gate   │
                  └───────┬───────┘
                          ▼
              ┌───────────┼────────────┐
              ▼           ▼            ▼
           Retry       Discount     Escalate
              │
              ▼
        Payment Executor
        Test Simulator
              │
              ▼
          PostgreSQL
          Audit Trail
              │
              ▼
       Shimmer Dashboard
```

---

# 🔄 Example Recovery Flow

### Recoverable payment

```text
insufficient_funds
        ↓
Retryable
        ↓
AI → retry_in_24h
        ↓
Safety Gate → ALLOWED
        ↓
Scheduled Retry
        ↓
Payment Recovered
        ↓
Audit + Metrics Updated
```

### Non-retryable payment

```text
card_expired
        ↓
Non-retryable
        ↓
AI recommendation checked
        ↓
Safety Gate → RETRY BLOCKED
        ↓
Human Escalation
        ↓
Audit Trail
```

---

# 🔐 Reliability & Safety

### HMAC Verification

Incoming webhook requests are verified using **HMAC SHA-256** before processing.

### Idempotency

`razorpay_event_id` prevents duplicate webhook processing.

### Deterministic Fallback

If the AI service is unavailable:

```text
AI unavailable
      ↓
Deterministic fallback
      ↓
Safety Gate
      ↓
Action
```

The safety layer remains active even when the LLM is unavailable.

---

# 🗄️ Database

Shimmer uses PostgreSQL.

The `events` table stores the recovery audit trail, including:

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
processed
created_at
ruled_out_json
intervention_cost
```

This provides the historical data required for:

- Recovery metrics
- Customer history
- Auditability
- AI audit queries
- Financial analysis

---

# 🔌 API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/webhook` | Receive payment failure events |
| `GET` | `/metrics` | Recovery and financial metrics |
| `GET` | `/customers` | Customer recovery states |
| `GET` | `/audit/:id` | Customer audit history |
| `POST` | `/query-audit` | Natural-language audit queries |
| `POST` | `/reset-demo` | Reset demonstration data |

### Example `/metrics`

```json
{
  "total_customers": 40,
  "recovered_count": 20,
  "escalated_or_gave_up": 20,
  "still_pending": 0,
  "revenue_at_risk_inr": 27960,
  "amount_recovered_inr": 13980,
  "revenue_recovered_inr": 13980,
  "recovery_rate_pct": 50,
  "revenue_recovery_rate_pct": 50,
  "total_agent_cost_inr": 7,
  "net_recovered_inr": 13973,
  "net_value_created_inr": 13973,
  "avg_attempts_to_recovery": 2
}
```

---

# 🧰 Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express.js |
| AI | Anthropic Claude |
| Database | PostgreSQL |
| Frontend | HTML, CSS, JavaScript |
| Charts | Chart.js |
| Payments | Razorpay webhook-compatible integration |
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
├── seed.js
├── package.json
├── README.md
│
├── public/
│   └── dashboard.html
│
└── .gitignore
```

---
# 🌐 Deployment

Shimmer is deployed on Render and can be accessed here:

**Live Application:** https://recovery-agent-go6k.onrender.com/

The deployed application includes:

- AI-powered payment recovery decisions
- Safety-gated action execution
- PostgreSQL-backed audit trail
- Recovery metrics
- Customer ledger
- AI audit assistant
- Near-real-time dashboard updates

### GitHub Repository

https://github.com/Debasmita012/recovery-agent

# ⚙️ Run Locally

### 1. Clone

```bash
git clone https://github.com/Debasmita012/recovery-agent.git
cd recovery-agent
```

### 2. Install

```bash
npm install
```

### 3. Configure environment variables

Create `.env`:

```env
PORT=3000
DATABASE_URL=your_postgresql_connection_string
ANTHROPIC_API_KEY=your_anthropic_api_key
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

### 4. Start

```bash
npm start
```

Open:

```text
http://localhost:3000
```

---


# ⚠️ Current Prototype Limitations

Shimmer is currently a buildathon prototype.

- The payment executor **simulates payment outcomes** rather than charging real customers.
- Intervention costs are simulated for the demonstration.
- Dashboard updates use 6-second polling rather than WebSockets.
- AI availability depends on configured Anthropic credentials.
- Deterministic fallback logic is used when AI is unavailable.

These limitations keep the demonstration safe, deterministic, and reproducible.

---

# 🚀 Future Improvements

Potential production extensions include:

- Real payment execution with production safeguards
- Predictive recovery probability
- Adaptive retry timing
- Customer lifetime-value-aware decisions
- Multi-payment-method optimization
- WebSocket/SSE dashboard updates
- Recovery strategy A/B testing
- Production human-support integrations
- Advanced fraud/risk signals
- AI decision-quality monitoring

---

# 🏆 Why Shimmer?

Traditional payment recovery focuses on:

> **"Retry the payment."**

Shimmer focuses on:

> **"Choose the safest and most economically valuable next action."**

It combines:

```text
AI Reasoning
     +
Deterministic Safety
     +
Automated Recovery
     +
Explainable Auditing
     +
Financial Measurement
```

The result is an autonomous recovery system that can make decisions, execute permitted actions, explain blocked actions, and measure the value it creates.

---

# ✨ Shimmer

### **AI proposes. Rules dispose. Revenue recovers.**
