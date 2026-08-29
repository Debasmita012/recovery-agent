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
  const first = eventsContext[0] || {};
  if (first.action_taken === 'escalate_human' || first.outcome === 'stopped') {
    return `Recovery attempts for ${first.customer_id || 'this account'} were stopped because the failure reason was '${first.reason_code || 'unknown'}'. Safety gate rules escalated this case to a human support agent instead of attempting invalid retries.`;
  }
  return `Audit summary for ${first.customer_id || 'recent accounts'}: payment failure reason '${first.reason_code || 'unknown'}'. The system initiated action '${first.action_taken}' (${first.llm_reasoning || 'rule decision'}), resulting in outcome status '${first.outcome}'.`;
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
