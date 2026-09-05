const { pool } = require('./db');
const { classifyFailure } = require('./classifier');
const { decideAction } = require('./decisionEngine');
const {
  executeAction,
  executeScheduledRetry,
} = require('./executor');


/**
 * Handle an incoming payment.failed webhook.
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

  if (!payment || Object.keys(payment).length === 0) {
    throw new Error('Missing payment entity in webhook payload');
  }


  // ---------------------------------------------------------
  // Customer information
  // ---------------------------------------------------------

  const notes = payment.notes || {};

  const customerId =
    notes.customer_id ||
    notes.customerId ||
    payment.customer_id;

  if (!customerId) {
    throw new Error('Missing customer_id in payment payload');
  }

  const amount =
  (Number(payment.amount) || 0) / 100;
const razorpayPaymentId =
  payment.id || null;

const razorpayOrderId =
  payment.order_id || null;

const razorpaySubscriptionId =
  payment.subscription_id ||
  notes.subscription_id ||
  null;
  const subscriptionId =
    payment.subscription_id ||
    notes.subscription_id ||
    `sub_${customerId}`;

  const email =
    payment.email ||
    notes.email ||
    `${customerId}@example.com`;


  


  // ---------------------------------------------------------
  // Upsert customer
  // ---------------------------------------------------------

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
      email,
      subscriptionId,
      amount,
    ]
  );
    // ---------------------------------------------------------
  // Atomic idempotency claim
  // ---------------------------------------------------------
  //
  // Razorpay may deliver the same webhook more than once.
  // INSERT ... ON CONFLICT makes the event claim atomic,
  // so the same event can never trigger recovery twice.
  //

  const claimResult = await pool.query(
    `INSERT INTO events (
      razorpay_event_id,
      customer_id,
      event_type,
      processed
    )
    VALUES ($1, $2, $3, false)
    ON CONFLICT (razorpay_event_id)
    DO NOTHING
    RETURNING id`,
    [
      razorpayEventId,
      customerId,
      eventType,
    ]
  );

  if (claimResult.rows.length === 0) {
    console.log(
      `[idempotency] Skipping duplicate event ${razorpayEventId}`
    );

    return {
      status: 'duplicate',
      message: 'Event already processed',
      eventId: razorpayEventId,
    };
  }

  const claimedEventId =
    claimResult.rows[0].id;


  // ---------------------------------------------------------
  // Determine attempt number
  // ---------------------------------------------------------

  const attemptResult = await pool.query(
    `SELECT COUNT(*)::int AS count
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

  const attemptNumber =
    previousAttempts + 1;


  // ---------------------------------------------------------
  // Classify failure
  // ---------------------------------------------------------

  const classification =
    classifyFailure(payload);

  const reason =
    classification.reason;

  const retryable =
    classification.retryable;


  // ---------------------------------------------------------
  // AI decision
  //
  // IMPORTANT:
  // decisionEngine.js expects "attempts".
  // ---------------------------------------------------------
const decision = await decideAction({
  reasonCode: reason,
  retryable,
  attemptNumber,
  amount,
});


  // ---------------------------------------------------------
  // Execute selected action
  // ---------------------------------------------------------

 const result = executeAction({
  action: decision.action,
  amount,
  reason,
  attemptNumber,
  razorpayPaymentId,
  razorpayOrderId,
  razorpaySubscriptionId,
});


  // ---------------------------------------------------------
    // ---------------------------------------------------------
  // Complete the claimed audit event
  // ---------------------------------------------------------

  await pool.query(
    `UPDATE events
     SET
       reason_code = $1,
       action_taken = $2,
       llm_reasoning = $3,
       outcome = $4,
       attempt_number = $5,
       amount_recovered = $6,
       retry_at = $7,
       processed = $8,
       ruled_out_json = $9,
       intervention_cost = $10
     WHERE id = $11`,
    [
      reason,
      decision.action,
      decision.reasoning || '',
      result.status,
      attemptNumber,
      result.amountRecovered || 0,
      result.retryAt || null,

      // Pending retry events remain unprocessed.
      result.status !== 'pending',

      JSON.stringify(
        decision.ruledOut || []
      ),

      result.interventionCost || 0,

      claimedEventId,
    ]
  );


  console.log(
    `Processed ${customerId}: ` +
    `${reason} → ${decision.action} → ${result.status}`
  );


  return {
    status: result.status,
    customerId,
    reason,
    action: decision.action,
    attemptNumber,
    amountRecovered:
      result.amountRecovered || 0,
    retryAt:
      result.retryAt || null,
    interventionCost:
      result.interventionCost || 0,
    decisionSource:
      decision.decision_source || 'ai',
    reasoning:
      decision.reasoning || '',
  };
}


/**
 * Process a scheduled retry.
 *
 * IMPORTANT:
 * This is no longer treated as a request to schedule
 * another retry.
 *
 * Once the retry is due, we directly execute the
 * scheduled payment retry.
 */
async function reprocessRetry(eventRow) {
  if (!eventRow) {
    throw new Error('Missing event row');
  }


  // ---------------------------------------------------------
  // Load customer
  // ---------------------------------------------------------

  const customerResult = await pool.query(
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

  const customer =
    customerResult.rows[0];

  const amount =
    Number(customer.amount) || 0;

  const currentAttempt =
    Number(eventRow.attempt_number) || 1;

  const nextAttempt =
    currentAttempt + 1;


  console.log(
    `[retry] customer=${eventRow.customer_id}, ` +
    `reason=${eventRow.reason_code}, ` +
    `attempt=${nextAttempt}`
  );


  // ---------------------------------------------------------
  // Execute the scheduled retry directly
  // ---------------------------------------------------------
  //
  // We have already decided earlier that this payment
  // should be retried.
  //
  // The retry worker's job is now to execute that retry,
  // not to schedule the same action again.
  // ---------------------------------------------------------

  const result =
    executeScheduledRetry({
      amount,
      reason: eventRow.reason_code,
      attemptNumber: nextAttempt,
    });


  // ---------------------------------------------------------
  // Record retry result
  // ---------------------------------------------------------

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
      `retry_${eventRow.id}_${Date.now()}`,
      eventRow.customer_id,
      'scheduled_retry',
      eventRow.reason_code,
      'retry_now',
      `Executed scheduled retry for ${eventRow.reason_code}.`,
      result.status,
      nextAttempt,
      result.amountRecovered || 0,
      result.retryAt || null,

      // Recovered/stopped events are complete.
      result.status !== 'pending',

      '[]',

      result.interventionCost || 0,
    ]
  );


  // ---------------------------------------------------------
  // Mark original scheduled event as processed
  // ---------------------------------------------------------

  await pool.query(
    `UPDATE events
     SET processed = true
     WHERE id = $1`,
    [eventRow.id]
  );


  console.log(
    `[retry] ${eventRow.customer_id}: ` +
    `${result.status}, ` +
    `recovered=₹${result.amountRecovered || 0}`
  );


  return {
    status: result.status,
    customerId:
      eventRow.customer_id,
    reason:
      eventRow.reason_code,
    action: 'retry_now',
    attemptNumber: nextAttempt,
    amountRecovered:
      result.amountRecovered || 0,
    retryAt:
      result.retryAt || null,
    interventionCost:
      result.interventionCost || 0,
  };
}


module.exports = {
  handleFailure,
  reprocessRetry,
};