const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const { pool, initSchema } = require('./db');
const { handleFailure } = require('./handler');
const { getMetrics } = require('./metrics');
const { startRetryCron } = require('./cron');

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' });

const app = express();

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; } // raw body needed for signature check
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

function verifySignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'secret123';
  if (!signature || !rawBody) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  let valid = false;
  try {
    valid = verifySignature(req.rawBody, signature);
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    return res.status(400).send('Invalid signature');
  }

  // Acknowledge immediately, then process async - avoids Razorpay retry storms on slow handlers.
  res.status(200).send('ok');

  const event = req.body.event;
  const payload = req.body.payload;
  const razorpayEventId = req.body.event_id || `${event}_${Date.now()}_${Math.random()}`;

  if (event === 'payment.failed' || event === 'subscription.charged.failed') {
    handleFailure(event, payload, razorpayEventId).catch(err => {
      console.error('handleFailure error:', err.message);
    });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/audit/:customerId', async (req, res) => {
  try {
    const rows = await pool.query(
      'SELECT * FROM events WHERE customer_id = $1 ORDER BY created_at ASC',
      [req.params.customerId]
    );
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/customers', async (req, res) => {
  try {
    const customers = await pool.query('SELECT * FROM customers ORDER BY id ASC');
    const events = await pool.query('SELECT * FROM events ORDER BY created_at ASC');
    const eventMap = {};
    for (const ev of events.rows) {
      eventMap[ev.customer_id] = ev;
    }
    const result = customers.rows.map(c => ({
      id: c.id,
      email: c.email,
      amount: c.amount,
      latest_outcome: eventMap[c.id]?.outcome || 'pending',
      latest_action: eventMap[c.id]?.action_taken || '-'
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/query-audit', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query string is required' });

    const match = query.match(/cust_\d+/i);
    let eventsContext = [];
    if (match) {
      const customerId = match[0].toLowerCase();
      const rows = await pool.query(
        'SELECT customer_id, event_type, reason_code, action_taken, llm_reasoning, outcome, attempt_number, ruled_out_json, created_at FROM events WHERE customer_id = $1 ORDER BY created_at ASC',
        [customerId]
      );
      eventsContext = rows.rows;
    } else {
      const rows = await pool.query(
        'SELECT customer_id, event_type, reason_code, action_taken, llm_reasoning, outcome, attempt_number, created_at FROM events ORDER BY created_at DESC LIMIT 15'
      );
      eventsContext = rows.rows;
    }

    if (eventsContext.length === 0) {
      return res.json({ answer: `No audit event logs found for '${query}'.` });
    }

    let answer = '';
    try {
      if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('xxxx')) {
        const response = await anthropicClient.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `You are an AI recovery agent audit assistant for a subscription SaaS business. Answer this user query based strictly on the provided audit event context. Keep your response concise, professional, and limited to 2-3 sentences.\n\nUser Query: "${query}"\n\nAudit Event Logs Context:\n${JSON.stringify(eventsContext, null, 2)}`
          }]
        });
        answer = response.content.find(b => b.type === 'text')?.text?.trim() || 'Unable to generate audit answer.';
      } else {
        answer = buildFallbackAnswer(query, eventsContext);
      }
    } catch (err) {
      console.warn('[query-audit] LLM query error, using fallback synthesizer:', err.message);
      answer = buildFallbackAnswer(query, eventsContext);
    }

    res.json({ answer, contextCount: eventsContext.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildFallbackAnswer(query, eventsContext) {
  const q = query.toLowerCase();
  const match = q.match(/cust_\d+/i);

  if (match) {
    const targetId = match[0].toLowerCase();
    const targetEvent = eventsContext.find(e => e.customer_id.toLowerCase() === targetId) || eventsContext[0];
    if (targetEvent) {
      if (targetEvent.action_taken === 'escalate_human' || targetEvent.outcome === 'stopped') {
        return `Recovery attempts for ${targetEvent.customer_id} were stopped because the failure reason was '${targetEvent.reason_code || 'non_retryable'}'. Safety gate rules escalated this case to a human support agent to prevent invalid retry loops.`;
      } else if (targetEvent.action_taken === 'retry_now') {
        return `Account ${targetEvent.customer_id} encountered '${targetEvent.reason_code}'. The system executed an immediate charge retry (outcome status: ${targetEvent.outcome}).`;
      } else if (targetEvent.action_taken === 'send_discount_offer') {
        return `Account ${targetEvent.customer_id} experienced '${targetEvent.reason_code}'. A 10% discount recovery email was dispatched to retain the customer.`;
      } else if (targetEvent.action_taken === 'retry_in_24h') {
        return `Account ${targetEvent.customer_id} experienced '${targetEvent.reason_code}'. A 24-hour delayed retry attempt was scheduled by the decision engine.`;
      } else {
        return `Account ${targetEvent.customer_id} audit record: failure reason '${targetEvent.reason_code}'. System executed action '${targetEvent.action_taken}' with outcome status '${targetEvent.outcome}'.`;
      }
    }
  }

  // Keyword-based dynamic synthesis for general queries
  if (q.includes('payment') || q.includes('fail') || q.includes('decline') || q.includes('card')) {
    const reasons = eventsContext.map(e => e.reason_code).filter(Boolean);
    const topReasons = [...new Set(reasons)].slice(0, 3).join(', ');
    return `Payment failures analyzed across recent transactions show primary root causes: ${topReasons || 'insufficient funds and card expiration'}. Non-retryable cases are immediately safety-gated to human support.`;
  }

  if (q.includes('retry') || q.includes('attempt') || q.includes('gate') || q.includes('rule')) {
    const retriedCount = eventsContext.filter(e => e.action_taken === 'retry_now' || e.action_taken === 'retry_in_24h').length;
    const gatedCount = eventsContext.filter(e => e.action_taken === 'escalate_human' || e.outcome === 'stopped').length;
    return `Retry audit breakdown: ${retriedCount} transactions were approved for retries, while ${gatedCount} transactions were blocked by safety rules to protect customer accounts.`;
  }

  if (q.includes('discount') || q.includes('nudge') || q.includes('offer')) {
    const discountCount = eventsContext.filter(e => e.action_taken === 'send_discount_offer').length;
    return `Discount campaigns: ${discountCount} accounts received 10% promotional retention offers to recover subscription payments.`;
  }

  // Default summary fallback
  const total = eventsContext.length;
  const recovered = eventsContext.filter(e => e.outcome === 'recovered').length;
  const stopped = eventsContext.filter(e => e.outcome === 'stopped').length;
  const pending = eventsContext.filter(e => e.outcome === 'pending').length;
  return `Audit Ledger Summary (${total} events analyzed): ${recovered} accounts successfully rescued, ${stopped} stopped/escalated via safety gates, and ${pending} pending retry scheduling.`;
}

app.post('/reset-demo', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.query.key;
    const expectedKey = process.env.ADMIN_SECRET || 'admin123';
    if (adminKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid admin key for reset-demo endpoint' });
    }
    await pool.query('TRUNCATE events, customers RESTART IDENTITY CASCADE');
    res.json({ status: 'reset' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on 0.0.0.0:${PORT}`);
      startRetryCron();
    });
  })
  .catch(err => {
    console.error('Failed to init schema:', err.message);
    process.exit(1);
  });
