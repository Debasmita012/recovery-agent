const db = require('./db');
const { classifyFailure } = require('./classifier');
const { decideAction } = require('./decisionEngine');
const {
  executeAction,
  executeScheduledRetry,
} = require('./executor');


/**
 * Handle an incoming Razorpay payment.failed webhook.
 *
 * Flow:
 *
 * Webhook
 *   ↓
 * Idempotency check
 *   ↓
 * Customer upsert
 *   ↓
 * Failure classification
 *   ↓
 * AI decision
 *   ↓
 * Safety-gated action
 *   ↓
 * Executor
 *   ↓
 * Audit log
 */
async function handleFailure(
  webhookBody,
  razorpayEventId,
  eventType = 'payment.failed'
) {
  const payload = webhookBody?.payload || {};
  const payment = payload?.payment?.entity || {};

  if (!razorpayEventId) {
    throw new Error('Missing Razorpay event ID');
  }

  if (!payment) {
    throw new Error('Missing payment entity in webhook payload');
  }

  // ---------------------------------------------------------
  // Extract customer information
  // ---------------------------------------------------------

  const notes = payment.notes || {};

  const customerId =
    notes.customer_id ||
    notes.customerId ||
    payment.customer_id;

  if (!customerId) {
    throw new Error('Missing customer_id in payment payload');
  }

  const amount = Number(payment.amount) || 0;

  const subscriptionId =
    payment.subscription_id ||
    notes.subscription_id ||
    `sub_${customerId}`;

  const email =
    payment.email ||
    notes.email ||
    `${customerId}@example.com`;


  // ---------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------

  const existingEvent = await db.query(
    `SELECT id
     FROM events
     WHERE razorpay_event_id = $1`,
    [razorpayEventId]
  );

  if (existingEvent.rows.length > 0) {
    return {
      status: 'duplicate',
      message: 'Event already processed',
      eventId: razorpayEventId,
    };
  }


  // ---------------------------------------------------------
  // Upsert customer
  // ---------------------------------------------------------

  await db.query(
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
      email,
      subscriptionId,
      amount,
    ]
  );


  // ---------------------------------------------------------
  // Determine current recovery attempt
  //
  // The original failed payment counts as attempt 1.
  // A subsequent scheduled retry becomes attempt 2.
  // ---------------------------------------------------------

  const attemptResult = await db.query(
    `SELECT COUNT(*) AS count
     FROM events
     WHERE customer_id = $1
       AND action_taken IN (
         'retry_now',
         'retry_in_24h',
         'send_discount_offer'
       )`,
    [customerId]
  );

  const previousAttempts =
    Number(attemptResult.rows[0]?.count) || 0;

  const attemptNumber = previousAttempts + 1;


  // ---------------------------------------------------------
  // Classify payment failure
  // ---------------------------------------------------------

  const classification = classifyFailure(payload.payment);

  const reason = classification.reason;
  const retryable = classification.retryable;


  // ---------------------------------------------------------
  // Ask decision engine for recovery action
  // ---------------------------------------------------------

  const decision = await decideAction({
    reason,
    retryable,
    attemptNumber,
    amount,
  });


  // ---------------------------------------------------------
  // Execute bounded action
  // ---------------------------------------------------------

  const result = executeAction({
    action: decision.action,
    amount,
    reason,
    attemptNumber,
  });


  // ---------------------------------------------------------
  // Write audit record
  // ---------------------------------------------------------

  await db.query(
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
      reason,
      decision.action,
      decision.reasoning || '',
      result.status,
      attemptNumber,
      result.amountRecovered || 0,
      result.retryAt || null,
      false,
      JSON.stringify(decision.ruledOut || []),
      result.interventionCost || 0,
    ]
  );


  return {
    status: result.status,
    customerId,
    reason,
    action: decision.action,
    attemptNumber,
    amountRecovered: result.amountRecovered || 0,
    retryAt: result.retryAt || null,
    interventionCost: result.interventionCost || 0,
    decisionSource: decision.decision_source,
    reasoning: decision.reasoning,
  };
}


/**
 * Process a scheduled retry.
 *
 * A retry_in_24h event is initially stored as "pending".
 * When the retry processor runs, this function performs the
 * actual simulated recovery attempt.
 */
async function reprocessRetry(eventRow) {
  if (!eventRow) {
    throw new Error('Missing event row');
  }

  // ---------------------------------------------------------
  // Load customer
  // ---------------------------------------------------------

  const customerResult = await db.query(
    `SELECT
       id,
       email,
       subscription_id,
       amount
     FROM customers
     WHERE id = $1`,
    [eventRow.customer_id]
  );

  if (customerResult.rows.length === 0) {
    throw new Error(
      `Customer ${eventRow.customer_id} not found for retry`
    );
  }

  const customer = customerResult.rows[0];

  const amount = Number(customer.amount) || 0;

  const currentAttempt =
    Number(eventRow.attempt_number) || 1;

  const nextAttempt = currentAttempt + 1;


  // ---------------------------------------------------------
  // Ask decision engine whether another action is allowed
  // ---------------------------------------------------------

  const decision = await decideAction({
    reason: eventRow.reason_code,
    retryable: true,
    attemptNumber: nextAttempt,
    amount,
  });


  // ---------------------------------------------------------
  // Execute scheduled retry
  // ---------------------------------------------------------

  let result;

  /*
   * If the AI still wants another delayed retry, we simulate
   * the actual scheduled retry attempt.
   */
  if (decision.action === 'retry_in_24h') {
    result = executeScheduledRetry({
      amount,
      reason: eventRow.reason_code,
      attemptNumber: nextAttempt,
    });
  } else {
    /*
     * If the AI changes the action to retry_now,
     * escalation, discount, etc., execute that action normally.
     */
    result = executeAction({
      action: decision.action,
      amount,
      reason: eventRow.reason_code,
      attemptNumber: nextAttempt,
    });
  }


  // ---------------------------------------------------------
  // Create audit event for retry attempt
  // ---------------------------------------------------------

  await db.query(
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
      `retry_${eventRow.id}_${Date.now()}`,
      eventRow.customer_id,
      'payment.retry',
      eventRow.reason_code,
      decision.action,
      decision.reasoning || '',
      result.status,
      nextAttempt,
      result.amountRecovered || 0,
      result.retryAt || null,
      false,
      JSON.stringify(decision.ruledOut || []),
      result.interventionCost || 0,
    ]
  );


  // ---------------------------------------------------------
  // Mark original scheduled event as processed
  // ---------------------------------------------------------

  await db.query(
    `UPDATE events
     SET processed = true
     WHERE id = $1`,
    [eventRow.id]
  );


  return {
    status: result.status,
    customerId: eventRow.customer_id,
    reason: eventRow.reason_code,
    action: decision.action,
    attemptNumber: nextAttempt,
    amountRecovered: result.amountRecovered || 0,
    retryAt: result.retryAt || null,
    interventionCost: result.interventionCost || 0,
    decisionSource: decision.decision_source,
    reasoning: decision.reasoning,
  };
}


module.exports = {
  handleFailure,
  reprocessRetry,
};