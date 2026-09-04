const { pool } = require("./db");
const { classifyFailure } = require("./classifier");
const { decideAction } = require("./decisionEngine");
const { executeAction } = require("./executor");

/**
 * Handle a new payment failure webhook.
 *
 * Important:
 * attempt_number represents recovery attempts for the customer,
 * not simply the number of rows/events in the database.
 */
async function handleFailure(payload, eventId, eventType = "payment.failed") {
  const customerId =
    payload?.payload?.payment?.entity?.notes?.customer_id ||
    payload?.payload?.subscription?.entity?.notes?.customer_id ||
    payload?.notes?.customer_id;

  if (!customerId) {
    throw new Error("customer_id missing from webhook payload");
  }

  const amount =
    Number(payload?.payload?.payment?.entity?.amount) ||
    Number(payload?.amount) ||
    0;

  const subscriptionId =
    payload?.payload?.subscription?.entity?.id ||
    payload?.subscription_id ||
    null;

  // ------------------------------------------------------------------
  // 1. Prevent duplicate processing of the same Razorpay event
  // ------------------------------------------------------------------
  const duplicate = await pool.query(
    "SELECT id FROM events WHERE razorpay_event_id = $1 LIMIT 1",
    [eventId]
  );

  if (duplicate.rows.length > 0) {
    console.log(`[handler] Duplicate event ignored: ${eventId}`);
    return;
  }

  // ------------------------------------------------------------------
  // 2. Classify the failure
  // ------------------------------------------------------------------
  const { reason, retryable } = classifyFailure(payload);

  // ------------------------------------------------------------------
  // 3. Determine the current recovery attempt.
  //
  // We count only recovery actions that actually represent an attempt.
  // This avoids treating unrelated webhook/event rows as attempts.
  // ------------------------------------------------------------------
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

  const attemptNumber = priorAttempts.rows[0].c + 1;

  console.log(
    `[handler] ${customerId} | reason=${reason} | retryable=${retryable} | attempt=${attemptNumber}`
  );

  // ------------------------------------------------------------------
  // 4. Ask decision engine for the safest recovery action
  // ------------------------------------------------------------------
  const decision = await decideAction({
    reasonCode: reason,
    retryable,
    attemptNumber,
    amount,
  });

  console.log(
    `[handler] Decision: ${decision.action} | source=${decision.decision_source}`
  );

  // ------------------------------------------------------------------
  // 5. Execute the selected action
  // ------------------------------------------------------------------
  const result = await executeAction(decision.action, {
    customerId,
    subscriptionId,
    amount,
    attemptNumber,
  });

  // ------------------------------------------------------------------
  // 6. Store audit record
  // ------------------------------------------------------------------
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
    `,
    [
      eventId,
      customerId,
      eventType,
      reason,
      decision.action,
      decision.reasoning,
      result.outcome,
      attemptNumber,
      result.amountRecovered || 0,
      result.retryAt || null,
      result.processed ?? true,
      JSON.stringify(decision.ruled_out || []),
      result.interventionCost || 0,
    ]
  );

  console.log(
    `[handler] Stored ${eventId} | ${customerId} | ${decision.action} | ${result.outcome}`
  );
}


/**
 * Process a scheduled retry.
 *
 * A scheduled retry is itself a recovery attempt, so we preserve the
 * existing attempt number rather than counting the scheduled_retry row
 * as another independent attempt.
 */
async function reprocessRetry(eventRow) {
  const customerId = eventRow.customer_id;
  const amount = Number(eventRow.amount || 0);
  const attemptNumber = Number(eventRow.attempt_number || 1);

  console.log(
    `[retry] Processing ${customerId} | attempt=${attemptNumber}`
  );

  // The original retryable failure reason is preserved.
  const reason = eventRow.reason_code || "unknown";

  // Re-evaluate the next action using the existing attempt number.
  const decision = await decideAction({
    reasonCode: reason,
    retryable: true,
    attemptNumber,
    amount,
  });

  console.log(
    `[retry] Decision: ${decision.action} | source=${decision.decision_source}`
  );

  const result = await executeAction(decision.action, {
    customerId,
    subscriptionId: null,
    amount,
    attemptNumber,
  });

  const retryEventId = `retry_${eventRow.id}_${Date.now()}`;

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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
    `,
    [
      retryEventId,
      customerId,
      "scheduled_retry",
      reason,
      decision.action,
      decision.reasoning,
      result.outcome,
      attemptNumber,
      result.amountRecovered || 0,
      result.retryAt || null,
      result.processed ?? true,
      JSON.stringify(decision.ruled_out || []),
      result.interventionCost || 0,
    ]
  );

  // Mark the original scheduled retry as processed.
  await pool.query(
    `
      UPDATE events
      SET processed = true
      WHERE id = $1
    `,
    [eventRow.id]
  );

  console.log(
    `[retry] Completed ${customerId} | ${decision.action} | ${result.outcome}`
  );
}


module.exports = {
  handleFailure,
  reprocessRetry,
};