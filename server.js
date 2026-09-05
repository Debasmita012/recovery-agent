const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const { pool, initSchema } = require('./db');
const { handleFailure } = require('./handler');
const { getMetrics } = require('./metrics');
const { startRetryCron } = require('./cron');

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'dummy'
});

const app = express();


// ============================================================
// EXPRESS CONFIGURATION
// ============================================================

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.static(path.join(__dirname, 'public')));


// ============================================================
// HOME PAGE
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'dashboard.html')
  );
});


// ============================================================
// RAZORPAY WEBHOOK SIGNATURE VERIFICATION
// ============================================================

function verifySignature(rawBody, signature) {
  const secret =
    process.env.RAZORPAY_WEBHOOK_SECRET || 'secret123';

  if (!signature || !rawBody) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);

  if (expectedBuf.length !== sigBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuf,
    sigBuf
  );
}


// ============================================================
// RAZORPAY WEBHOOK
// ============================================================

app.post('/webhook', (req, res) => {
  const signature =
    req.headers['x-razorpay-signature'];

  let valid = false;

  try {
    valid = verifySignature(
      req.rawBody,
      signature
    );
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    return res
      .status(400)
      .send('Invalid signature');
  }

  // ----------------------------------------------------------
  // Acknowledge webhook immediately.
  // Processing happens asynchronously.
  // ----------------------------------------------------------

  res.status(200).send('ok');

 const event = req.body.event;

const razorpayEventId =
  req.headers['x-razorpay-event-id'] ||
  req.body.event_id ||
  `${event}_${Date.now()}_${Math.random()}`;
  // ----------------------------------------------------------
  // IMPORTANT:
  //
  // handler.js expects:
  //
  // handleFailure(
  //   fullWebhookBody,
  //   eventId,
  //   eventType
  // )
  //
  // Therefore we pass req.body, NOT req.body.payload.
  // ----------------------------------------------------------

 if (
  event === 'payment.failed' ||
  event === 'subscription.charged.failed'
) {
  handleFailure(
    req.body,
    razorpayEventId,
    event
  ).catch(err => {
    console.error(
      'handleFailure error:',
      err.message
    );
  });
}


// ----------------------------------------------------------
// Successful Razorpay payment
// ----------------------------------------------------------

if (event === 'payment.captured') {
  handleSuccessfulPayment(
    req.body,
    razorpayEventId,
    event
  ).catch(err => {
    console.error(
      'handleSuccessfulPayment error:',
      err.message
    );
  });
}


// ----------------------------------------------------------
// order.paid is intentionally not processed separately.
//
// Razorpay can send both:
//   payment.captured
//   order.paid
//
// Counting both would double-count the same recovered payment.
// ----------------------------------------------------------


if (event === 'subscription.charged') {
  handleSuccessfulCharge(
    req.body,
    razorpayEventId,
    event
  ).catch(err => {
    console.error(
      'handleSuccessfulCharge error:',
      err.message
    );
  });
}
});
// ============================================================
// RAZORPAY SUCCESSFUL SUBSCRIPTION CHARGE
// ============================================================

async function handleSuccessfulCharge(
  webhookBody,
  razorpayEventId,
  eventType = 'subscription.charged'
) {
  const payload = webhookBody?.payload || {};
  const subscription =
    payload?.subscription?.entity || {};

  const payment =
    payload?.payment?.entity || {};

  const notes =
    subscription.notes ||
    payment.notes ||
    {};

  const customerId =
    notes.customer_id ||
    notes.customerId ||
    payment.customer_id;

  if (!customerId) {
    console.warn(
      'Successful charge received without customer_id'
    );

    return;
  }

  const amount =
    Number(payment.amount) ||
    Number(subscription.amount) ||
    0;

  const paymentId =
    payment.id || null;

  const subscriptionId =
    subscription.id ||
    payment.subscription_id ||
    null;

  // ----------------------------------------------------------
  // Idempotency
  // ----------------------------------------------------------

  const existingEvent =
    await pool.query(
      `SELECT id
       FROM events
       WHERE razorpay_event_id = $1`,
      [razorpayEventId]
    );

  if (existingEvent.rows.length > 0) {
    console.log(
      `Skipping duplicate successful event ${razorpayEventId}`
    );

    return;
  }

  // ----------------------------------------------------------
  // Make sure customer exists
  // ----------------------------------------------------------

  await pool.query(
    `INSERT INTO customers (
      id,
      email,
      subscription_id,
      amount
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id)
    DO UPDATE SET
      subscription_id = EXCLUDED.subscription_id,
      amount = EXCLUDED.amount`,
    [
      customerId,
      payment.email ||
        notes.email ||
        `${customerId}@example.com`,
      subscriptionId ||
        `sub_${customerId}`,
      amount,
    ]
  );

  // ----------------------------------------------------------
  // Record successful recovery/payment
  // ----------------------------------------------------------

  await pool.query(
    `INSERT INTO events (
      razorpay_event_id,
      customer_id,
      event_type,
      reason_code,
      action_taken,
      llm_reasoning,
      outcome,
      attempt_number,
      amount_recovered,
      retry_at,
      processed,
      ruled_out_json,
      intervention_cost
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13
    )`,
    [
      razorpayEventId,
      customerId,
      eventType,
      null,
      'payment_captured',
      'Razorpay confirmed a successful subscription charge.',
      'recovered',
      0,
      amount,
      null,
      true,
      JSON.stringify([]),
      0,
    ]
  );

  console.log(
    `[recovery] ${customerId}: ` +
    `Razorpay confirmed successful charge ` +
    `₹${amount}` +
    `${paymentId ? ` (${paymentId})` : ''}`
  );
}
// ============================================================
// RAZORPAY SUCCESSFUL PAYMENT CAPTURE
// ============================================================

async function handleSuccessfulPayment(
  webhookBody,
  razorpayEventId,
  eventType = 'payment.captured'
) {
  const payload = webhookBody?.payload || {};
  const payment = payload?.payment?.entity || {};

  if (!payment || Object.keys(payment).length === 0) {
    throw new Error(
      'Missing payment entity in captured-payment webhook'
    );
  }

  const notes = payment.notes || {};

  const customerId =
    notes.customer_id ||
    notes.customerId ||
    payment.customer_id;

  if (!customerId) {
    console.warn(
      '[payment.captured] Missing customer_id; ' +
      'cannot safely associate payment with a recovery case.'
    );

    return;
  }

  // Razorpay sends INR amounts in paise.
  const amount =
    (Number(payment.amount) || 0) / 100;

  const paymentId =
    payment.id || null;

  const orderId =
    payment.order_id || null;


  // ----------------------------------------------------------
  // Idempotency
  // ----------------------------------------------------------

  const existingEvent =
    await pool.query(
      `SELECT id
       FROM events
       WHERE razorpay_event_id = $1`,
      [razorpayEventId]
    );

  if (existingEvent.rows.length > 0) {
    console.log(
      `[payment.captured] Duplicate event ${razorpayEventId}; skipping.`
    );

    return;
  }


  // ----------------------------------------------------------
  // Find the customer's most recent unresolved recovery event
  // ----------------------------------------------------------

  const previousEvent =
    await pool.query(
      `SELECT
         id,
         customer_id,
         amount_recovered,
         outcome,
         action_taken,
         attempt_number,
         reason_code
       FROM events
       WHERE customer_id = $1
         AND outcome IN ('pending', 'stopped')
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId]
    );


  // ----------------------------------------------------------
  // Make sure customer exists
  // ----------------------------------------------------------

  await pool.query(
    `INSERT INTO customers (
      id,
      email,
      subscription_id,
      amount
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id)
    DO UPDATE SET
      email = EXCLUDED.email,
      subscription_id = EXCLUDED.subscription_id,
      amount = EXCLUDED.amount`,
    [
      customerId,
      payment.email ||
        notes.email ||
        `${customerId}@example.com`,
      payment.subscription_id ||
        notes.subscription_id ||
        `sub_${customerId}`,
      amount,
    ]
  );


  // ----------------------------------------------------------
  // Record successful captured payment
  // ----------------------------------------------------------

  await pool.query(
    `INSERT INTO events (
      razorpay_event_id,
      customer_id,
      event_type,
      reason_code,
      action_taken,
      llm_reasoning,
      outcome,
      attempt_number,
      amount_recovered,
      retry_at,
      processed,
      ruled_out_json,
      intervention_cost
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13
    )`,
    [
      razorpayEventId,
      customerId,
      eventType,
      previousEvent.rows[0]?.reason_code || null,
      'payment_captured',
      `Razorpay confirmed successful payment capture. ` +
      `Payment ID: ${paymentId || 'unknown'}. ` +
      `Order ID: ${orderId || 'unknown'}.`,
      'recovered',
      previousEvent.rows[0]?.attempt_number || 1,
      amount,
      null,
      true,
      JSON.stringify([]),
      0,
    ]
  );


  console.log(
    `[payment.captured] ${customerId}: ` +
    `₹${amount} recovered ` +
    `(payment=${paymentId || 'unknown'}, ` +
    `order=${orderId || 'unknown'})`
  );


  return {
    status: 'recovered',
    customerId,
    amountRecovered: amount,
    paymentId,
    orderId,
  };
}
// ============================================================
// METRICS
// ============================================================

app.get('/metrics', async (req, res) => {
  try {
    const metrics = await getMetrics();

    res.json(metrics);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// ============================================================
// CUSTOMER AUDIT TRAIL
// ============================================================

app.get('/audit/:customerId', async (req, res) => {
  try {
    const rows = await pool.query(
      `
        SELECT *
        FROM events
        WHERE customer_id = $1
        ORDER BY created_at ASC
      `,
      [req.params.customerId]
    );

    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// ============================================================
// CUSTOMERS
// ============================================================

app.get('/customers', async (req, res) => {
  try {
    const customers = await pool.query(
      'SELECT * FROM customers ORDER BY id ASC'
    );

    /*
     * Get the most recent event for each customer
     * that contains a reason_code.
     *
     * This prevents a later scheduled/recovery event
     * without a reason_code from hiding the original
     * payment failure reason.
     */
    const events = await pool.query(
      `SELECT DISTINCT ON (customer_id)
        customer_id,
        action_taken,
        outcome,
        reason_code,
        created_at
       FROM events
       WHERE reason_code IS NOT NULL
       ORDER BY customer_id, created_at DESC`
    );

    /*
     * Get the most recent event separately.
     *
     * This is used for the current action/outcome.
     */
    const latestEvents = await pool.query(
      `SELECT DISTINCT ON (customer_id)
        customer_id,
        action_taken,
        outcome,
        created_at
       FROM events
       ORDER BY customer_id, created_at DESC`
    );

    const reasonMap = {};
    const latestMap = {};

    for (const ev of events.rows) {
      reasonMap[ev.customer_id] = ev;
    }

    for (const ev of latestEvents.rows) {
      latestMap[ev.customer_id] = ev;
    }

    const result = customers.rows.map(c => {
      const latestEvent = latestMap[c.id];
      const reasonEvent = reasonMap[c.id];

      return {
        id: c.id,
        email: c.email,
        amount: c.amount,

        latest_outcome:
          latestEvent?.outcome || 'pending',

        latest_action:
          latestEvent?.action_taken || '-',

        latest_reason:
          reasonEvent?.reason_code || 'unknown'
      };
    });

    res.json(result);

  } catch (err) {
    console.error(
      'Customers endpoint error:',
      err
    );

    res.status(500).json({
      error: err.message
    });
  }
});


// ============================================================
// AI AUDIT QUERY
// ============================================================

app.post('/query-audit', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        error: 'Query string is required'
      });
    }

    const match =
      query.match(/cust_\d+/i);

    let eventsContext = [];

    // --------------------------------------------------------
    // Customer-specific query
    // --------------------------------------------------------

    if (match) {
      const customerId =
        match[0].toLowerCase();

      const rows = await pool.query(
        `
          SELECT
            customer_id,
            event_type,
            reason_code,
            action_taken,
            llm_reasoning,
            outcome,
            attempt_number,
            ruled_out_json,
            created_at
          FROM events
          WHERE customer_id = $1
          ORDER BY created_at ASC
        `,
        [customerId]
      );

      eventsContext = rows.rows;
    }

    // --------------------------------------------------------
    // General query
    // --------------------------------------------------------

    else {
      const rows = await pool.query(
        `
          SELECT
            customer_id,
            event_type,
            reason_code,
            action_taken,
            llm_reasoning,
            outcome,
            attempt_number,
            created_at
          FROM events
          ORDER BY created_at DESC
          LIMIT 15
        `
      );

      eventsContext = rows.rows;
    }

    if (eventsContext.length === 0) {
      return res.json({
        answer:
          `No audit event logs found for '${query}'.`
      });
    }

    let answer = '';

    // ========================================================
    // CLAUDE AUDIT ASSISTANT
    // ========================================================

    try {
      if (
        process.env.ANTHROPIC_API_KEY &&
        !process.env.ANTHROPIC_API_KEY.includes('xxxx')
      ) {
        const response =
          await anthropicClient.messages.create({
            model:
              process.env.ANTHROPIC_MODEL ||
              'claude-3-5-sonnet-20241022',

            max_tokens: 300,

            messages: [
              {
                role: 'user',

                content:
                  `You are an AI recovery agent audit assistant for a subscription SaaS business. ` +
                  `Answer this user query based strictly on the provided audit event context. ` +
                  `Keep your response concise, professional, and limited to 2-3 sentences.\n\n` +

                  `User Query: "${query}"\n\n` +

                  `Audit Event Logs Context:\n` +
                  `${JSON.stringify(
                    eventsContext,
                    null,
                    2
                  )}`
              }
            ]
          });

        answer =
          response.content
            .find(
              b => b.type === 'text'
            )
            ?.text
            ?.trim() ||
          'Unable to generate audit answer.';

      } else {
        answer = buildFallbackAnswer(
          query,
          eventsContext
        );
      }

    } catch (err) {
      console.warn(
        '[query-audit] LLM query error, using fallback synthesizer:',
        err.message
      );

      answer = buildFallbackAnswer(
        query,
        eventsContext
      );
    }

    res.json({
      answer,
      contextCount:
        eventsContext.length
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// ============================================================
// FALLBACK AUDIT ANSWER ENGINE
// ============================================================

function buildFallbackAnswer(query, eventsContext) {
  const q = query.toLowerCase().trim();

  const total = eventsContext.length;

  // ==========================================================
  // BASIC COUNTS
  // ==========================================================

  const recovered = eventsContext.filter(
    e => e.outcome === 'recovered'
  ).length;

  const stopped = eventsContext.filter(
    e =>
      e.outcome === 'stopped' ||
      e.action_taken === 'escalate_human'
  ).length;

  const pending = eventsContext.filter(
    e => e.outcome === 'pending'
  ).length;

  const retryNow = eventsContext.filter(
    e => e.action_taken === 'retry_now'
  ).length;

  const retry24h = eventsContext.filter(
    e => e.action_taken === 'retry_in_24h'
  ).length;

  const discounts = eventsContext.filter(
    e => e.action_taken === 'send_discount_offer'
  ).length;

  // ==========================================================
  // CUSTOMER-SPECIFIC QUESTIONS
  // ==========================================================

  const customerMatch = q.match(/cust_\d+/i);

  if (customerMatch) {
    const targetId = customerMatch[0].toLowerCase();

    const customerEvents = eventsContext.filter(
      e =>
        e.customer_id &&
        e.customer_id.toLowerCase() === targetId
    );

    if (customerEvents.length === 0) {
      return `No audit events were found for ${targetId}.`;
    }

    const latest =
      customerEvents[customerEvents.length - 1];

    const reasons = [
      ...new Set(
        customerEvents
          .map(e => e.reason_code)
          .filter(Boolean)
      )
    ];

    const actions = [
      ...new Set(
        customerEvents
          .map(e => e.action_taken)
          .filter(Boolean)
      )
    ];

    return (
      `${targetId} has ${customerEvents.length} recorded audit event(s). ` +
      `Failure reason(s): ${reasons.join(', ') || 'not recorded'}. ` +
      `Actions taken: ${actions.join(', ') || 'none recorded'}. ` +
      `Latest outcome: ${latest.outcome || 'unknown'}.`
    );
  }

  // ==========================================================
  // FRAUD / SUSPICIOUS ACTIVITY QUESTIONS
  // ==========================================================

  if (
    q.includes('fraud') ||
    q.includes('suspicious') ||
    q.includes('scam') ||
    q.includes('risk') ||
    q.includes('abnormal') ||
    q.includes('unusual')
  ) {
    const customerAttempts = {};

    eventsContext.forEach(e => {
      if (!e.customer_id) return;

      if (!customerAttempts[e.customer_id]) {
        customerAttempts[e.customer_id] = 0;
      }

      customerAttempts[e.customer_id]++;
    });

    const repeatedCustomers = Object.entries(
      customerAttempts
    )
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    const stoppedCustomers = [
      ...new Set(
        eventsContext
          .filter(
            e =>
              e.outcome === 'stopped' ||
              e.action_taken === 'escalate_human'
          )
          .map(e => e.customer_id)
          .filter(Boolean)
      )
    ];

    return (
      `Potential fraud or suspicious activity should be identified by looking for ` +
      `repeated recovery attempts, abnormal failure patterns, repeated activity ` +
      `on the same customer, and cases that trigger safety-gate escalation. ` +
      `In the current ${total}-event audit context, ${repeatedCustomers.length} ` +
      `customer(s) have multiple recorded events and ${stoppedCustomers.length} ` +
      `customer(s) were stopped or escalated. These are risk indicators, not proof ` +
      `of fraud, and should be reviewed before taking enforcement action.`
    );
  }

  // ==========================================================
  // PAYMENT / FAILURE QUESTIONS
  // ==========================================================

  if (
    q.includes('payment') ||
    q.includes('failure') ||
    q.includes('failed') ||
    q.includes('decline') ||
    q.includes('card') ||
    q.includes('reason')
  ) {
    const reasonCounts = {};

    eventsContext.forEach(e => {
      if (!e.reason_code) return;

      reasonCounts[e.reason_code] =
        (reasonCounts[e.reason_code] || 0) + 1;
    });

    const topReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => `${reason} (${count})`);

    return (
      `Across the ${total} recent audit events, the main recorded ` +
      `payment failure reasons are ${topReasons.join(', ') || 'not available'}. ` +
      `${stopped} case(s) were stopped or escalated rather than continuing ` +
      `automatic recovery.`
    );
  }

  // ==========================================================
  // RETRY QUESTIONS
  // ==========================================================

  if (
    q.includes('retry') ||
    q.includes('attempt') ||
    q.includes('again')
  ) {
    return (
      `In the ${total} recent audit events, ${retryNow} ` +
      `were assigned immediate retries and ${retry24h} ` +
      `were scheduled for a 24-hour retry. ` +
      `${stopped} case(s) were stopped or escalated by the recovery safety rules.`
    );
  }

  // ==========================================================
  // SAFETY / ESCALATION QUESTIONS
  // ==========================================================

  if (
    q.includes('safety') ||
    q.includes('escalat') ||
    q.includes('gate') ||
    q.includes('blocked') ||
    q.includes('stop')
  ) {
    return (
      `The recovery safety layer stopped or escalated ${stopped} ` +
      `of the ${total} recent audit events. These cases are separated from ` +
      `automatic retries to prevent unsafe or repeated recovery attempts.`
    );
  }

  // ==========================================================
  // DISCOUNT QUESTIONS
  // ==========================================================

  if (
    q.includes('discount') ||
    q.includes('offer') ||
    q.includes('promotion')
  ) {
    return (
      `${discounts} of the ${total} recent audit events resulted in a ` +
      `discount offer. The recovery policy uses discounts as a retention ` +
      `mechanism rather than as a default response to every failure.`
    );
  }

  // ==========================================================
  // PERFORMANCE / SUMMARY QUESTIONS
  // ==========================================================

  if (
    q.includes('summary') ||
    q.includes('performance') ||
    q.includes('successful') ||
    q.includes('recovery') ||
    q.includes('recover')
  ) {
    return (
      `Audit performance across the ${total} recent events: ` +
      `${recovered} recovered, ${stopped} stopped or escalated, ` +
      `${pending} pending, ${retryNow} immediate retries, ` +
      `${retry24h} delayed retries, and ${discounts} discount offers.`
    );
  }

  // ==========================================================
  // DEFAULT — STILL ANSWER THE QUESTION
  // ==========================================================

  return (
    `I analyzed ${total} recent audit events. ` +
    `The available audit data contains customer IDs, failure reasons, ` +
    `recovery actions, attempt numbers, and outcomes. ` +
    `For a more specific answer, ask about fraud indicators, payment failures, ` +
    `retry decisions, safety gates, customer accounts, or recovery performance.`
  );
}

// ============================================================
// RESET DEMO
// ============================================================

app.post('/reset-demo', async (req, res) => {
  try {
    const adminKey =
      req.headers['x-admin-key'] ||
      req.query.key;

    const expectedKey =
      process.env.ADMIN_SECRET ||
      'admin123';

    if (adminKey !== expectedKey) {
      return res.status(401).json({
        error:
          'Unauthorized: Invalid admin key for reset-demo endpoint'
      });
    }

    await pool.query(
      'TRUNCATE events, customers RESTART IDENTITY CASCADE'
    );

    res.json({
      status: 'reset'
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// ============================================================
// SERVER START
// ============================================================

const PORT =
  process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `Server listening on 0.0.0.0:${PORT}`
        );

        startRetryCron();
      }
    );
  })
  .catch(err => {
    console.error(
      'Failed to init schema:',
      err.message
    );

    process.exit(1);
  });