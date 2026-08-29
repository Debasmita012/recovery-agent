# ✨ Shimmer — AI Payment Recovery & Gating Intelligence

An autonomous, safety-gated payment recovery agent for subscription SaaS businesses. When subscription charges fail on Razorpay, Shimmer classifies the root cause, reasons over context using **Claude 3.5 Sonnet**, validates decisions against strict safety rules, executes recovery actions, and logs full audit trails to PostgreSQL.

---

## 🌟 Standout Features & Architectural Guardrails

### 1. Gated AI Decision Engine ("The AI Proposes, Code Disposes")
- **Bounded Action Menu:** The decision engine can only select from 5 fixed actions (`retry_now`, `retry_in_24h`, `send_discount_offer`, `escalate_human`, `give_up`).
- **Server-Side Safety Override:** The code hard-enforces business rules and silently overrides invalid LLM proposals to `escalate_human` if:
  - Max retry attempt cap (**3 attempts**) is reached.
  - Failure reason is permanently non-retryable (`card_expired`, `invalid_card`).
  - Discount offer exceeds maximum threshold (**10%**).

### 2. "Why Did You NOT Retry?" Safety Gate Audit
Most recovery tools only show why an action *was* taken. Shimmer explicitly evaluates and logs why alternative actions were **ruled out or blocked by safety rules**, categorizing each action menu item as `SELECTED`, `BLOCKED BY RULE`, or `REJECTED BY AI`.

### 3. Natural-Language Audit Assistant (`POST /query-audit`)
Inspectors and finance teams can query the audit trail in plain English (e.g., *"Why did we give up on cust_7?"* or *"Summarize bank decline recoveries"*). Claude analyzes the actual historical audit event logs from PostgreSQL and generates concise explanations.

### 4. Financial Net ROI & Intervention Cost Tracking
Tracks true net value created by deducting operational intervention costs from gross revenue recovered:
$$\text{Net Value Created} = \text{Gross Amount Recovered} - (\text{Discount Costs} + \text{Human Escalation Support Costs})$$

### 5. Webhook Security & Idempotency
- **HMAC Signature Verification:** Verifies `x-razorpay-signature` header using SHA256 HMAC before processing.
- **Idempotency Guard:** Deduplicates events based on `razorpay_event_id` to prevent double-charging or duplicate recovery metrics.

---

## 🔄 End-to-End Workflow Architecture

```
                                 ┌─────────────────────────┐
                                 │ Razorpay Webhook Event  │
                                 └────────────┬────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ HMAC Signature Validation │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │   Idempotency Check DB    │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ Deterministic Classifier  │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │  Claude 3.5 Sonnet / LLM  │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ Server-Side Safety Gating │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ Action Execution & Costs  │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ PostgreSQL Audit Logging  │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ Live Financial Dashboard  │
                                └───────────────────────────┘
```

---

## 🔌 API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/webhook` | Receives and verifies Razorpay `payment.failed` webhooks |
| `GET` | `/metrics` | Returns gross recovered, total costs, net ROI, and recovery rates |
| `GET` | `/customers` | Lists all customer accounts with latest actions and outcomes |
| `GET` | `/audit/:id` | Returns full event history and safety gate breakdown for a customer |
| `POST` | `/query-audit` | Natural-language AI query over historical audit logs |
| `POST` | `/reset-demo` | Clears demo ledger (Secured via `x-admin-key` header) |

---

## 🚀 Quickstart Guide

### 1. Installation
```bash
git clone https://github.com/Debasmita012/recovery-agent.git
cd recovery-agent
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
# Razorpay (test mode)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret

# Anthropic API Key
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# PostgreSQL Database URL
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require

# Server Config
BASE_URL=http://127.0.0.1:3000
PORT=3000
ADMIN_SECRET=your_admin_secret
```

> [!NOTE]
> **Zero-Config Fallback Mode:** If `DATABASE_URL` or `ANTHROPIC_API_KEY` are omitted, Shimmer automatically uses an **in-memory PostgreSQL engine (`pg-mem`)** and a **Deterministic Rule Engine**, allowing full offline execution out-of-the-box.

### 3. Start Server & Seed Demo Data
```bash
# Terminal 1: Start the server and cron worker
npm start

# Terminal 2: Seed synthetic signed webhooks
node seed.js 40
```

Open **`http://localhost:3000`** in your browser to view the live Financial Recovery Ledger dashboard.
