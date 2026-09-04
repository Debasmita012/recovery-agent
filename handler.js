const { pool } = require('./db');
const { classifyFailure } = require('./classifier');
const { decideAction } = require('./decisionEngine');
const { executeAction } = require('./executor');


// ============================================================
// HANDLE PAYMENT FAILURE
// ============================================================

async function handleFailure(webhookBody, razorpayEventId, eventType) {
  // ----------------------------------------------------------
  // Extract the inner Razorpay payload.
  //
  // Webhook structure:
  //
  // {
  //   event: "payment.failed",
  //   event_id: "...",
  //   payload: {
  //     payment: {
  //       entity: {...}
  //     }
  //   }
  // }
  // ----------------------------------------------------------

  const payload = webhookBody?.payload;

  if (!payload?.payment?.entity) {
    throw new Error(
      'Invalid webhook payload: payment.entity missing'
    );
  }

  const entity = payload.payment.entity;

  // ----------------------------------------------------------
  // Extract customer information
  // ----------------------------------------------------------

  const customerId =
    entity.notes?.customer_id ||
    entity.customer_id;

  if (!customerId) {
    throw new Error(
      'customer_id missing from payment entity'
    );
  }

  const amount =
    Number(entity.amount) || 0;

  const subscriptionId =
    entity.notes?.subscription_id ||
    null;


  // ==========================================================
  // IDEMPOTENCY
  // ==========================================================

  const existing = await pool.query(
    `
      SELECT id
      FROM events
      WHERE razorpay_event_id = $1
      LIMIT 1
    `,
    [razorpayEventId]
  );

  if (existing.rows.length > 0) {
    console.log(
      `[handler] Duplicate event ignored: ${razorpayEventId}`
    );
    return;
  }


  // ==========================================================
  // CREATE / UPDATE CUSTOMER
  // ==========================================================

  await pool.query(
    `
      INSERT INTO customers (
        id,
        email,
        subscription_id,
        amount
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET
        email = COALESCE(EXCLUDED.email, customers.email),
        subscription_id =
          COALESCE(
            EXCLUDED.subscription_id,
            customers.subscription_id
          ),
        amount = EXCLUDED.amount
    `,
    [
      customerId,
      entity.email || null,
      subscriptionId,
      amount
    ]
  );


  // ==========================================================
  // DETERMINE CURRENT RECOVERY ATTEMPT
  // ==========================================================

  const priorAttempts = await pool.query(
    `
      SELECT COUNT(*)::int AS c
      FROM events
      WHERE customer_id = $1
        AND action_taken IN (
          'retry_now',
          'retry_in_24h',
          'send_discount_offer'
        )
    `,
    [customerId]
  );

  const attemptNumber =
    priorAttempts.rows[0].c + 1;


  // ==========================================================
  // CLASSIFY FAILURE
  //
  // classifier.js expects the INNER payload:
  //
  // payload.payment.entity
  // ==========================================================

  const {
    reason,
    retryable
  } = classifyFailure(payload);


  console.log(
    `[handler] ${customerId} | ` +
    `reason=${reason} | ` +
    `retryable=${retryable} | ` +
    `attempt=${attemptNumber}`
  );


  // ==========================================================
  // DECISION ENGINE
  // ==========================================================

  const decision = await decideAction({
    reasonCode: reason,
    retryable,
    attemptNumber,
    amount
  });


  console.log(
    `[handler] Decision: ${decision.action} | ` +
    `source=${decision.decision_source}`
  );


  // ==========================================================
  // EXECUTE ACTION
  // ==========================================================

  const result = await executeAction(
    decision.action,
    {
      customerId,
      subscriptionId,
      amount,
      attemptNumber
    }
  );


  // executor.js returns:
  //
  // {
  //   status: 'recovered' | 'pending' | 'stopped',
  //   amountRecovered,
  //   retryAt
  // }
  //
  // Therefore we use result.status.
  // ==========================================================

  const outcome =
    result.status || 'pending';


  // ==========================================================
  // BUILD AUDIT INFORMATION
  // ==========================================================

  const ruledOut =
    Array.isArray(decision.ruled_out)
      ? decision.ruled_out
      : [];


  // ==========================================================
  // STORE EVENT
  // ==========================================================

  await pool.query(
    `
      INSERT INTO events (
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
      )
    `,
    [
      razorpayEventId,
      customerId,
      eventType || webhookBody.event || 'payment.failed',
      reason,
      decision.action,
      decision.reasoning || '',
      outcome,
      attemptNumber,
      Number(result.amountRecovered) || 0,
      result.retryAt || null,
      outcome !== 'pending',
      JSON.stringify(ruledOut),
      Number(result.interventionCost) || 0
    ]
  );


  console.log(
    `[handler] Processed ${customerId}: ` +
    `${decision.action} -> ${outcome}`
  );
}


// ============================================================
// PROCESS SCHEDULED RETRY
// ============================================================

async function reprocessRetry(eventRow) {
  // ----------------------------------------------------------
  // Find customer
  // ----------------------------------------------------------

  const customer = await pool.query(
    `
      SELECT *
      FROM customers
      WHERE id = $1
    `,
    [eventRow.customer_id]
  );

  if (customer.rows.length === 0) {
    console.warn(
      `[retry] Customer not found: ${eventRow.customer_id}`
    );

    return;
  }

  const customerData =
    customer.rows[0];

  const customerId =
    customerData.id;

  const amount =
    Number(customerData.amount) || 0;

  const subscriptionId =
    customerData.subscription_id || null;


  // ----------------------------------------------------------
  // Preserve the attempt number from the scheduled retry.
  // ----------------------------------------------------------

  const attemptNumber =
    Number(eventRow.attempt_number) || 1;


  console.log(
    `[retry] Processing ${customerId} | ` +
    `attempt=${attemptNumber}`
  );


  // ----------------------------------------------------------
  // Re-evaluate action
  // ----------------------------------------------------------

  const decision = await decideAction({
    reasonCode:
      eventRow.reason_code || 'unknown',

    retryable: true,

    attemptNumber,

    amount
  });


  console.log(
    `[retry] Decision: ${decision.action} | ` +
    `source=${decision.decision_source}`
  );


  // ----------------------------------------------------------
  // Execute
  // ----------------------------------------------------------

  const result = await executeAction(
    decision.action,
    {
      customerId,
      subscriptionId,
      amount,
      attemptNumber
    }
  );


  const outcome =
    result.status || 'pending';


  // ----------------------------------------------------------
  // Audit data
  // ----------------------------------------------------------

  const ruledOut =
    Array.isArray(decision.ruled_out)
      ? decision.ruled_out
      : [];


  // ----------------------------------------------------------
  // Create retry event
  // ----------------------------------------------------------

  await pool.query(
    `
      INSERT INTO events (
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
      )
    `,
    [
      `retry_${eventRow.id}_${Date.now()}`,

      customerId,

      'scheduled_retry',

      eventRow.reason_code ||
        'unknown',

      decision.action,

      decision.reasoning || '',

      outcome,

      attemptNumber,

      Number(result.amountRecovered) || 0,

      result.retryAt || null,

      outcome !== 'pending',

      JSON.stringify(ruledOut),

      Number(result.interventionCost) || 0
    ]
  );


  // ----------------------------------------------------------
  // Mark original scheduled retry as processed
  // ----------------------------------------------------------

  await pool.query(
    `
      UPDATE events
      SET processed = true
      WHERE id = $1
    `,
    [eventRow.id]
  );


  console.log(
    `[retry] Completed ${customerId}: ` +
    `${decision.action} -> ${outcome}`
  );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  handleFailure,
  reprocessRetry
};