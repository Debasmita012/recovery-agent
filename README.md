# ✨ Shimmer — AI Payment Recovery & Gating Intelligence

> **AI proposes. Rules dispose. Revenue recovers.**

Shimmer is an autonomous AI-powered payment recovery and decision-gating engine for subscription SaaS businesses.

Instead of blindly retrying every failed recurring payment, Shimmer analyzes the payment failure, determines the safest recovery strategy, applies deterministic financial safety rules, executes or schedules the permitted action, and records the complete decision in an auditable PostgreSQL event trail.

The system is designed around one core principle:

**AI can recommend an action, but deterministic safety rules decide what is actually allowed to happen.**

---

## 🏆 Buildathon

**Razorpay Buildathon 2026**

### Track 03 — AI Revenue Recovery

### Project

**Shimmer — AI Payment Recovery & Gating Intelligence**

---

# 📌 Table of Contents

- [Overview](#-overview)
- [Problem](#-problem)
- [Solution](#-solution)
- [Core Innovation](#-core-innovation)
- [How Shimmer Works](#-how-shimmer-works)
- [Architecture](#-architecture)
- [Payment Recovery Lifecycle](#-payment-recovery-lifecycle)
- [Failure Classification](#-failure-classification)
- [AI Decision Engine](#-ai-decision-engine)
- [Available Actions](#-available-actions)
- [Safety Gating](#-safety-gating)
- [Why Did You NOT Retry?](#-why-did-you-not-retry)
- [Audit Trail](#-audit-trail)
- [Reliability](#-reliability)
- [Retry Scheduling](#-retry-scheduling)
- [Recovery Economics](#-recovery-economics)
- [Dashboard](#-dashboard)
- [AI Audit Assistant](#-ai-audit-assistant)
- [Current Demo Results](#-current-demo-results)
- [API](#-api)
- [Database](#-database)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Environment Variables](#-environment-variables)
- [Local Setup](#-local-setup)
- [Running the Application](#-running-the-application)
- [Demo Workflow](#-demo-workflow)
- [Production Deployment](#-production-deployment)
- [Security](#-security)
- [Failure Handling](#-failure-handling)
- [Prototype Limitations](#-prototype-limitations)
- [Future Improvements](#-future-improvements)
- [Business Impact](#-business-impact)
- [Why Shimmer](#-why-shimmer)
- [Buildathon Pitch](#-buildathon-pitch)
- [Live Demo](#-live-demo)

---

# 🚀 Overview

Subscription businesses lose revenue when recurring payments fail.

A failed payment does not necessarily mean a customer has permanently churned.

Depending on the reason, the best next action may be:

- Retry immediately
- Retry later
- Offer a controlled discount
- Escalate to human support
- Stop recovery attempts

Shimmer automates this decision process.

The system combines:

- Payment webhook processing
- Failure classification
- AI-assisted decision making
- Deterministic safety gates
- Automated retry scheduling
- Payment outcome simulation
- PostgreSQL event auditing
- Recovery economics
- Natural-language audit analysis
- Near-real-time dashboard monitoring

---

# ❗ Problem

Failed subscription payments create **involuntary churn** and revenue leakage.

A traditional payment recovery system may use a fixed sequence such as:

```text
Payment fails
      ↓
Retry
      ↓
Retry again
      ↓
Retry again
      ↓
Give up
```

This approach does not understand why the payment failed.

For example:

### Temporary failure

```text
Insufficient funds
```

A retry later may succeed.

### Permanent failure

```text
Expired card
```

Repeatedly retrying is unlikely to recover the payment.

### Another temporary/uncertain failure

```text
Bank declined
```

A controlled retry may still be useful.

The problem is therefore not simply:

> "Should we retry?"

The more important question is:

> **"What is the safest and most economically valuable next action?"**

That is the problem Shimmer solves.

---

# 💡 Solution

Shimmer transforms payment recovery into an autonomous decision pipeline.

```text
Payment Failure
       ↓
Webhook Verification
       ↓
Idempotency Check
       ↓
Failure Classification
       ↓
AI Decision Engine
       ↓
Deterministic Safety Gate
       ↓
Action Executor
       ↓
Retry / Escalation / Recovery
       ↓
PostgreSQL Audit Trail
       ↓
Metrics
       ↓
Dashboard
```

The AI provides contextual reasoning.

The safety layer provides deterministic boundaries.

The executor performs the permitted action.

The database records what happened.

The dashboard exposes the result.

---

# 🧠 Core Innovation

The central design principle of Shimmer is:

> ## AI proposes. Rules dispose.

This means the LLM does **not** have unrestricted authority over financial actions.

Instead:

```text
                    AI
                     │
                     ▼
             Recommended Action
                     │
                     ▼
          ┌─────────────────────┐
          │   SAFETY GATE       │
          │                     │
          │ Max attempts        │
          │ Retryability        │
          │ Discount limit      │
          │ Financial rules     │
          └──────────┬──────────┘
                     │
              Allowed Action
                     │
                     ▼
                 Executor
```

This architecture combines the adaptability of AI with deterministic financial controls.

---

# 🔄 How Shimmer Works

When a payment failure occurs:

### Step 1 — Receive the event

The system receives a payment failure webhook.

Example:

```text
payment.failed
```

---

### Step 2 — Verify authenticity

The webhook is verified using HMAC SHA-256.

Invalid webhook requests are rejected.

---

### Step 3 — Check idempotency

The system uses the Razorpay event identifier:

```text
razorpay_event_id
```

to prevent duplicate processing.

---

### Step 4 — Classify the failure

The failure classifier determines the reason and whether the failure is retryable.

Examples:

```text
insufficient_funds → retryable
bank_declined      → retryable
card_expired       → non-retryable
invalid_card       → non-retryable
unknown            → retryable with fallback logic
```

---

### Step 5 — Ask the decision engine

The decision engine evaluates:

- Failure reason
- Retryability
- Previous attempts
- Payment amount
- Recovery context

and produces one of the supported actions.

---

### Step 6 — Apply safety gates

The selected action is checked against deterministic policies.

For example:

```text
Maximum attempts = 3
```

and:

```text
card_expired → no retry
invalid_card → no retry
```

and:

```text
discount ≤ 10%
```

---

### Step 7 — Execute or schedule

If permitted:

```text
retry_now
```

may execute immediately.

If the selected action is:

```text
retry_in_24h
```

the retry is scheduled for later execution.

---

### Step 8 — Record the decision

The system records:

- Decision
- Reason
- AI reasoning
- Attempt number
- Outcome
- Ruled-out alternatives
- Intervention cost
- Timestamp

---

### Step 9 — Update metrics

The dashboard calculates:

- Revenue at risk
- Revenue recovered
- Recovery rate
- Agent cost
- Net value created
- ROI
- Average attempts

---

# 🏗️ Architecture

```text
                     ┌───────────────────────┐
                     │   Payment Provider    │
                     │  Razorpay Webhook     │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   HMAC Verification   │
                     │       SHA-256         │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │      Idempotency      │
                     │  razorpay_event_id    │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  Failure Classifier   │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   AI Decision Engine  │
                     │       Claude          │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   Deterministic       │
                     │     Safety Gate       │
                     │                       │
                     │  Max 3 attempts       │
                     │  Retryability rules   │
                     │  Discount ≤ 10%      │
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┼────────────────┐
                 │               │                │
                 ▼               ▼                ▼
          ┌────────────┐  ┌────────────┐  ┌──────────────┐
          │ Retry      │  │ Discount   │  │ Human        │
          │ Workflow   │  │ Offer      │  │ Escalation   │
          └─────┬──────┘  └────────────┘  └──────────────┘
                │
                ▼
          ┌───────────────────────┐
          │ Payment Executor      │
          │ Test-mode Simulator   │
          └───────────┬───────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │      PostgreSQL       │
          │    Audit Event Log    │
          └───────────┬───────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │   Shimmer Dashboard   │
          │                       │
          │ KPIs                  │
          │ Funnel                │
          │ Failure Intelligence  │
          │ Decision Distribution │
          │ Recovery Ledger       │
          │ Audit Trail           │
          │ AI Assistant          │
          └───────────────────────┘
```

---

# 🔁 Payment Recovery Lifecycle

## Example 1 — Insufficient Funds

```text
Payment Failed
      ↓
insufficient_funds
      ↓
Retryable
      ↓
AI recommends retry_in_24h
      ↓
Safety gate allows retry
      ↓
Retry scheduled
      ↓
Scheduled retry executes
      ↓
Payment recovered
      ↓
Revenue recorded
```

---

## Example 2 — Expired Card

```text
Payment Failed
      ↓
card_expired
      ↓
Non-retryable
      ↓
Retry blocked
      ↓
Human escalation
      ↓
Audit trail records why
```

This prevents wasteful retries.

---

# 🧩 Failure Classification

Shimmer currently recognizes the following failure categories:

| Failure | Retryable | Typical Strategy |
|---|---|---|
| `insufficient_funds` | Yes | Retry later |
| `bank_declined` | Yes | Retry |
| `card_expired` | No | Human escalation |
| `invalid_card` | No | Human escalation |
| `unknown` | Controlled fallback | Deterministic fallback |

The classifier converts payment-provider failure information into a normalized internal reason code.

---

# 🤖 AI Decision Engine

The decision engine receives structured payment context.

Conceptually:

```text
Input
├── reasonCode
├── retryable
├── attempts
└── amount

        ↓

AI Decision Engine

        ↓

Action
```

Possible outputs:

```text
retry_now
retry_in_24h
send_discount_offer
escalate_human
give_up
```

The decision engine also validates that the resulting action is one of the supported actions.

---

# 🎯 Available Actions

## `retry_now`

Attempt recovery immediately.

Useful for failures where an immediate retry has a reasonable chance of success.

---

## `retry_in_24h`

Schedule another recovery attempt later.

Useful for temporary conditions such as insufficient funds.

---

## `send_discount_offer`

Provide a controlled customer incentive.

The safety layer prevents discounts from exceeding:

```text
10%
```

---

## `escalate_human`

Move the payment issue to human support.

Useful for:

- Expired cards
- Invalid cards
- Cases requiring customer intervention

---

## `give_up`

Stop further recovery attempts when continued intervention is no longer justified.

---

# 🛡️ Safety Gating

Safety is separated from AI reasoning.

The AI can recommend an action, but the safety layer has final authority.

## Rule 1 — Maximum attempts

```text
Maximum payment recovery attempts = 3
```

Additional retries are blocked after the limit.

---

## Rule 2 — Non-retryable failures

The system blocks retries for:

```text
card_expired
invalid_card
```

---

## Rule 3 — Discount limit

The maximum permitted discount is:

```text
10%
```

This prevents the AI from sacrificing excessive revenue in an attempt to recover a payment.

---

# 🔍 Why Did You NOT Retry?

A major Shimmer feature is **decision explainability**.

Most automation systems explain successful actions:

> "We retried the payment."

Shimmer also explains blocked actions:

> **"Why did we NOT retry?"**

For every audit event, the system can store ruled-out actions and the reason they were rejected.

Example:

```text
Customer:
cust_7

Failure:
card_expired

Retry:
BLOCKED

Reason:
card_expired is non-retryable.

Alternative:
Human escalation
```

This makes safety decisions inspectable rather than invisible.

---

# 📋 Audit Trail

Every important recovery event is stored in PostgreSQL.

The audit record can contain:

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

This provides a complete history of the agent's behavior.

---

# 🔐 Reliability

## HMAC SHA-256

Webhook authenticity is verified before processing.

```text
Webhook
   ↓
HMAC verification
   ↓
Valid?
   ├── No  → Reject
   └── Yes → Continue
```

---

## Idempotency

The system uses:

```text
razorpay_event_id
```

to prevent the same payment event from being processed repeatedly.

This is important because webhook delivery systems can deliver duplicate events.

---

## Deterministic Fallback

The AI service is not a single point of failure.

If the AI layer is unavailable, Shimmer uses deterministic fallback logic.

```text
                  AI Available
                       │
                       ▼
                AI Recommendation
                       │
                       ▼
                   Safety Gate

                       OR

                  AI Unavailable
                       │
                       ▼
              Deterministic Fallback
                       │
                       ▼
                   Safety Gate
```

The financial safety boundary therefore remains active regardless of AI availability.

---

# ⏰ Retry Scheduling

Shimmer supports delayed payment recovery.

For example:

```text
Payment failure
      ↓
retry_in_24h
      ↓
retry_at timestamp
      ↓
Cron processor
      ↓
Scheduled retry
      ↓
Outcome
```

The cron process identifies due retry events and invokes the retry workflow.

---

# 💰 Recovery Economics

Shimmer measures financial impact instead of only counting successful retries.

The main equation is:

```text
Net Value Created
=
Gross Recovered Revenue
-
Intervention Costs
```

Intervention costs include:

```text
Discount Costs
+
Human Escalation Costs
```

---

## Recovery Rate

Customer recovery rate:

```text
Recovered Customers
------------------- × 100
Total Customers
```

Revenue recovery rate:

```text
Recovered Revenue
----------------- × 100
Revenue at Risk
```

---

## ROI

The demo calculates:

```text
Net Value Created
---------------- × 100
Agent Cost
```

Because the demonstration uses a very small simulated intervention cost, the resulting ROI percentage can be extremely high.

For this reason, **Net Value Created** is the more useful business headline metric for the current demo.

---

# 📊 Current Demo Results

The current 40-customer demonstration produces:

| Metric | Result |
|---|---:|
| Total customers | **40** |
| Recovered customers | **20** |
| Escalated / stopped | **20** |
| Pending | **0** |
| Revenue at risk | **₹27,960** |
| Revenue recovered | **₹13,980** |
| Customer recovery rate | **50%** |
| Revenue recovery rate | **50%** |
| Agent intervention cost | **₹7** |
| Net value created | **₹13,973** |
| Average attempts to recovery | **2** |
| Discount cost | **₹0** |
| Human escalation cost | **₹7** |

### Demo economics

```text
₹27,960
Revenue at Risk
      ↓
₹13,980
Revenue Recovered
      ↓
₹7
Agent Cost
      ↓
₹13,973
Net Value Created
```

---

# 🖥️ Dashboard

The Shimmer dashboard provides an operational view of the recovery engine.

It includes:

## Executive KPIs

- Revenue at Risk
- Revenue Recovered
- Recovery Rate
- Net Value Created

---

## Revenue Recovery Funnel

Shows:

```text
Revenue at Risk
      ↓
Revenue Recovered
      ↓
Revenue Not Recovered
```

---

## Failure Intelligence

Breaks failed payments down by:

```text
insufficient_funds
bank_declined
card_expired
invalid_card
unknown
```

---

## Agent Decision Distribution

Shows the number of customers associated with:

```text
retry_now
retry_in_24h
send_discount_offer
escalate_human
give_up
```

---

## Recovery Outcomes

Visualizes:

- Recovered
- Escalated / stopped
- Pending

---

## Live Recovery Activity

Displays the latest customer recovery outcomes.

---

## Recovery Economics

Shows:

```text
Gross recovered
Discount cost
Human escalation cost
Net recovered
```

---

## Recovery Ledger

The dashboard provides a searchable customer-level ledger.

Users can search by:

- Customer ID
- Email
- Action
- Status
- Failure reason

Clicking a customer opens its audit history.

---

# ⚡ Near-Real-Time Monitoring

The dashboard continuously polls the backend.

The current frontend refresh interval is approximately:

```text
6 seconds
```

Therefore the dashboard provides:

> **Near-real-time monitoring with a 6-second refresh interval.**

It is currently polling-based rather than WebSocket-based.

---

# 💎 AI Audit Assistant

The dashboard includes a natural-language audit assistant.

Users can ask questions such as:

```text
Why did we give up on cust_7?
```

or:

```text
Why was cust_1 not retried?
```

or:

```text
Summarize recent recovery performance.
```

The question is sent to:

```text
POST /query-audit
```

The backend evaluates the audit information and returns an explanation.

This creates a natural-language interface over the payment recovery audit trail.

---

# 🔌 API

## POST `/webhook`

Receives payment failure events.

Example event:

```text
payment.failed
```

Processing flow:

```text
Verify
→ Deduplicate
→ Classify
→ Decide
→ Safety Gate
→ Execute
→ Audit
```

---

## GET `/metrics`

Returns aggregate system metrics.

Example:

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
  "roi_pct": 199614.3,
  "cost_breakdown": {
    "discount_costs_inr": 0,
    "human_escalation_costs_inr": 7
  },
  "avg_attempts_to_recovery": 2
}
```

---

## GET `/customers`

Returns customer-level recovery information used by the dashboard.

The data includes the customer's latest recovery action, outcome, and failure reason.

---

## GET `/audit/:customerId`

Returns the audit history for an individual customer.

Example:

```text
GET /audit/cust_7
```

---

## POST `/query-audit`

Accepts natural-language audit questions.

Example request:

```json
{
  "query": "Why was cust_7 not retried?"
}
```

---

## POST `/reset-demo`

Resets the demonstration dataset.

This is intended for controlled buildathon demonstration and testing.

---

# 🗄️ Database

Shimmer uses PostgreSQL.

## Customers

The customer table stores customer-level payment information, including:

- Customer ID
- Email
- Amount
- Payment context

---

## Events

The events table stores the recovery audit trail.

Important fields include:

```text
id
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

The event table is the source of truth for recovery history and auditability.

---

# 🧰 Technology Stack

## Backend

- Node.js
- Express.js

## AI

- Anthropic Claude
- Deterministic fallback decision engine

## Database

- PostgreSQL

## Frontend

- HTML
- CSS
- JavaScript
- Chart.js

## Payments

- Razorpay webhook-compatible event processing
- HMAC SHA-256 verification

## Deployment

- Render

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
├── package-lock.json
├── README.md
│
├── public/
│   └── dashboard.html
│
├── raw_data/
│
├── notebooks/
│
└── .gitignore
```

---

# ⚙️ Environment Variables

Create a local `.env` file.

Example:

```env
PORT=3000

DATABASE_URL=your_postgresql_connection_string

ANTHROPIC_API_KEY=your_anthropic_api_key

RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

Do not commit real credentials.

---

# 🛠️ Local Setup

## 1. Clone the repository

```bash
git clone https://github.com/Debasmita012/recovery-agent.git
```

---

## 2. Enter the project

```bash
cd recovery-agent
```

---

## 3. Install dependencies

```bash
npm install
```

---

## 4. Configure environment variables

Create:

```text
.env
```

and provide the required configuration.

---

## 5. Start the application

```bash
npm start
```

The dashboard will be available at:

```text
http://localhost:3000
```

---

# 🧪 Demo Workflow

The recommended buildathon demonstration consists of three scenarios.

---

## Scenario 1 — Recoverable Payment

Trigger a failure such as:

```text
insufficient_funds
```

Expected flow:

```text
Failure
   ↓
Classifier
   ↓
Retryable
   ↓
AI Decision
   ↓
retry_in_24h
   ↓
Safety Gate
   ↓
Scheduled Retry
   ↓
Recovery
```

The dashboard should show the recovered amount.

---

# Scenario 2 — Safety-Gated Payment

Trigger:

```text
card_expired
```

Expected behavior:

```text
card_expired
      ↓
Non-retryable
      ↓
Retry blocked
      ↓
Human escalation
```

Then open the audit trail.

Show:

> **Why did Shimmer NOT retry?**

This demonstrates that AI does not have unrestricted authority.

---

# Scenario 3 — Natural-Language Audit

Ask:

```text
Why was cust_1 not retried?
```

or:

```text
Why did we give up on cust_7?
```

The AI audit assistant returns a human-readable explanation based on recorded recovery events.

---

# 🌐 Production Deployment

The current application is deployed on Render.

Live dashboard:

```text
https://recovery-agent-go6k.onrender.com/
```

The production deployment exposes the same backend APIs used by the dashboard.

---

# 🔒 Security

Shimmer includes several security and reliability mechanisms.

## Webhook Authentication

HMAC SHA-256 validation prevents unauthenticated webhook payloads from entering the recovery pipeline.

---

## Idempotency

The payment provider's event ID is used to avoid processing the same event multiple times.

---

## Secrets

API keys and database credentials are stored in environment variables.

They should never be committed to source control.

---

## Financial Safety

AI recommendations are always constrained by deterministic policies.

This is particularly important for financial automation.

---

# 🚨 Failure Handling

Shimmer is designed to degrade safely.

### AI unavailable

```text
AI unavailable
      ↓
Deterministic fallback
      ↓
Safety gate
      ↓
Action
```

### Non-retryable payment

```text
Non-retryable
      ↓
Retry blocked
      ↓
Escalation
```

### Maximum attempts reached

```text
Attempts >= 3
      ↓
Retry blocked
      ↓
Stop / escalate
```

### Duplicate webhook

```text
Duplicate event ID
      ↓
Idempotency check
      ↓
Already processed
      ↓
No duplicate recovery action
```

---

# ⚠️ Prototype Limitations

Shimmer is currently a **buildathon prototype**.

## Payment execution

The current executor is a **test-mode simulator**.

It does not charge real customer payment methods.

Instead, it simulates recovery outcomes so the complete autonomous workflow can be demonstrated safely.

---

## Dashboard updates

The dashboard currently uses polling approximately every 6 seconds.

It is not currently implemented with WebSockets or Server-Sent Events.

---

## AI availability

The AI decision layer depends on the configured Anthropic API.

When the AI service is unavailable, deterministic fallback logic is used.

---

## Demo economics

Human escalation and other intervention costs are represented using simulated values for the demonstration.

Production deployments would use actual operational costs.

---

# 🔮 Future Improvements

Potential production extensions include:

### 1. Real payment execution

Integrate production-grade payment retry execution with additional financial safeguards.

---

### 2. Predictive recovery scoring

Predict the probability of successful recovery for each failed payment.

Example:

```text
Recovery probability = 82%
```

---

### 3. Adaptive retry timing

Instead of fixed retry timing, learn the optimal recovery window from historical data.

---

### 4. Customer lifetime value

Use customer LTV when determining whether an escalation or incentive is economically justified.

---

### 5. Multi-payment-method optimization

Allow the recovery engine to reason across available payment methods.

---

### 6. Streaming dashboard

Replace polling with:

```text
WebSocket
```

or:

```text
Server-Sent Events
```

for instant updates.

---

### 7. Recovery strategy experiments

Support A/B testing of different recovery strategies.

---

### 8. Advanced fraud and risk signals

Incorporate additional payment-risk signals into the decision process.

---

### 9. Production human support workflows

Connect escalations to customer-support systems.

---

### 10. Model evaluation

Track:

- AI recommendation quality
- Safety-gate rejection rate
- Recovery success rate
- False retry rate
- Cost per recovery

---

# 📈 Business Impact

Shimmer is designed to improve three business outcomes:

## 1. Recover more revenue

Automatically identify failures where another payment attempt has a reasonable chance of succeeding.

---

## 2. Reduce unnecessary intervention

Avoid repeatedly retrying payments that require customer action.

---

## 3. Improve decision transparency

Give operators a clear explanation of:

```text
What happened?
Why did the agent choose this?
What alternatives were rejected?
What did it cost?
What revenue was recovered?
```

This allows payment recovery to become a measurable financial operation rather than an opaque automation.

---

# 🆚 Why Shimmer?

Traditional recovery systems often follow static retry schedules.

Shimmer introduces an autonomous decision layer.

### Traditional approach

```text
Payment failed
      ↓
Fixed retry schedule
      ↓
Retry
      ↓
Retry
      ↓
Stop
```

### Shimmer

```text
Payment failed
      ↓
Understand failure
      ↓
Evaluate context
      ↓
AI recommendation
      ↓
Safety gate
      ↓
Economic decision
      ↓
Execute / schedule / escalate
      ↓
Audit
      ↓
Measure value
```

The difference is that Shimmer is not simply a retry engine.

It is a:

> **Payment recovery decision and governance system.**

---

# 🎤 Buildathon Pitch

A concise way to explain Shimmer:

> **"Payment failures don't all need the same response. Shimmer is an autonomous payment recovery agent that understands why a subscription payment failed, uses AI to recommend the best next action, and then applies deterministic safety gates before anything happens."**

The core message:

```text
AI proposes.
Rules dispose.
Revenue recovers.
```

---

# 🎬 Recommended Demo Story

Start with:

> "A subscription payment has failed. Most systems would retry it. Shimmer first asks why."

Then show:

```text
Insufficient Funds
       ↓
Retry Later
       ↓
Recovered
```

Then demonstrate:

```text
Expired Card
       ↓
Retry BLOCKED
       ↓
Human Escalation
```

Then open:

```text
Why Did You NOT Retry?
```

Finally show the economics:

```text
₹27,960 at risk
₹13,980 recovered
₹7 agent cost
₹13,973 net value created
```

Finish with:

> **"Shimmer doesn't blindly retry payments. It makes recovery decisions under financial safety constraints."**

---

# 📊 Key Metrics

The most important metrics for evaluating Shimmer are:

### Revenue at Risk

Total subscription revenue associated with failed payment accounts.

### Revenue Recovered

Gross revenue recovered by successful recovery actions.

### Customer Recovery Rate

Percentage of failed-payment customers successfully recovered.

### Revenue Recovery Rate

Percentage of at-risk revenue successfully recovered.

### Agent Cost

Operational intervention cost generated by the recovery system.

### Net Value Created

Recovered revenue minus intervention costs.

### Average Attempts to Recovery

Average number of payment attempts required for successful recovery.

---

# 🔗 Links

## Live Demo

https://recovery-agent-go6k.onrender.com/

## GitHub Repository

https://github.com/Debasmita012/recovery-agent

---

# 📝 Final Summary

Shimmer is an AI-powered autonomous payment recovery and gating system designed for subscription SaaS.

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
Economic Measurement
```

The result is a recovery system that can:

- Understand payment failures
- Choose recovery strategies
- Schedule retries
- Block unsafe retries
- Escalate difficult cases
- Recover simulated subscription revenue
- Explain every decision
- Measure the financial value created

The fundamental principle remains:

# ✨ AI proposes. Rules dispose. Revenue recovers.