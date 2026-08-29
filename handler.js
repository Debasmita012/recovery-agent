const { pool } = require('./db');
const { classifyFailure } = require('./classifier');
const { decideAction } = require('./decisionEngine');
const { executeAction } = require('./executor');

async function handleFailure(event, payload, razorpayEventId) {
  // Idempotency guard - Razorpay may deliver the same webhook more than once.
  const existing = await pool.query(
    'SELECT id FROM events WHERE razorpay_event_id = $1',
    [razorpayEventId]
  );
  if (existing.rows.length > 0) {
    console.log(`Skipping duplicate event ${razorpayEventId}`);
    return;
  }

  const entity = payload?.payment?.entity || {};
  const customerId = entity.notes?.customer_id || entity.customer_id || entity.id || `cust_${Date.now()}`;
  const amount = entity.amount || 0;
  const subscriptionId = entity.notes?.subscription_id || entity.subscription_id || null;

  await pool.query(
    `INSERT INTO customers (id, email, subscription_id, amount)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [customerId, entity.email || null, subscriptionId, amount]
  );

  const priorAttempts = await pool.query(
    'SELECT COUNT(*)::int AS c FROM events WHERE customer_id = $1',
    [customerId]
  );
  const attemptNumber = parseInt(priorAttempts.rows[0]?.c || 0, 10);

  const { reason, retryable } = classifyFailure(payload);
  const decision = await decideAction({ reasonCode: reason, retryable, attemptNumber, amount });
  const result = await executeAction(decision.action, { customerId, subscriptionId, amount });

  await pool.query(
    `INSERT INTO events
      (razorpay_event_id, customer_id, event_type, reason_code, action_taken,
       llm_reasoning, outcome, attempt_number, amount_recovered, retry_at,
       ruled_out_json, intervention_cost, processed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      razorpayEventId, customerId, event, reason, decision.action,
      decision.reasoning, result.status, attemptNumber + 1, result.amountRecovered || 0,
      result.retryAt || null, JSON.stringify(decision.ruledOutActions || []),
      result.interventionCost || 0, result.status !== 'pending'
    ]
  );

  console.log(`Processed ${customerId}: ${decision.action} -> ${result.status}`);
}

// Called by the cron job to reprocess a due retry_in_24h row.
async function reprocessRetry(eventRow) {
  const customer = await pool.query('SELECT * FROM customers WHERE id = $1', [eventRow.customer_id]);
  if (customer.rows.length === 0) return;
  const { id: customerId, amount } = customer.rows[0];

  const attemptNumber = parseInt(eventRow.attempt_number || 0, 10);
  const decision = await decideAction({
    reasonCode: eventRow.reason_code,
    retryable: true,
    attemptNumber,
    amount
  });
  const result = await executeAction(decision.action, { customerId, amount });

  await pool.query(
    `INSERT INTO events
      (razorpay_event_id, customer_id, event_type, reason_code, action_taken,
       llm_reasoning, outcome, attempt_number, amount_recovered, retry_at,
       ruled_out_json, intervention_cost, processed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      `retry_${eventRow.id}_${Date.now()}`, customerId, 'scheduled_retry', eventRow.reason_code,
      decision.action, decision.reasoning, result.status, attemptNumber + 1,
      result.amountRecovered || 0, result.retryAt || null, JSON.stringify(decision.ruledOutActions || []),
      result.interventionCost || 0, result.status !== 'pending'
    ]
  );

  await pool.query('UPDATE events SET processed = true WHERE id = $1', [eventRow.id]);
  console.log(`Reprocessed ${customerId}: ${decision.action} -> ${result.status}`);
}

module.exports = { handleFailure, reprocessRetry };
