/**
 * Payment Recovery Executor
 *
 * IMPORTANT:
 * This executor is a DEMO/test-mode simulator.
 * It does not charge real customers.
 *
 * The simulator is deterministic so that batch evaluations
 * produce reproducible recovery results.
 */

const RECOVERY_RULES = {
  insufficient_funds: {
    retry_now_success: false,
    retry_later_success: true,
  },

  bank_declined: {
    retry_now_success: true,
    retry_later_success: true,
  },

  unknown: {
    retry_now_success: true,
    retry_later_success: false,
  },

  card_expired: {
    retry_now_success: false,
    retry_later_success: false,
  },

  invalid_card: {
    retry_now_success: false,
    retry_later_success: false,
  },
};

function executeAction({
  action,
  amount,
  reason,
  attemptNumber = 1,
}) {
  const paymentAmount = Number(amount) || 0;

  const rule = RECOVERY_RULES[reason] || RECOVERY_RULES.unknown;

  // ---------------------------------------------------------
  // Immediate retry
  // ---------------------------------------------------------
  if (action === 'retry_now') {
    const recovered = Boolean(rule.retry_now_success);

    if (recovered) {
      return {
        status: 'recovered',
        amountRecovered: paymentAmount,
        retryAt: null,
        interventionCost: 0,
        message: `Payment recovered successfully on immediate retry at attempt ${attemptNumber}.`,
      };
    }

    return {
      status: 'pending',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: 0,
      message: `Immediate retry did not recover the payment; recovery remains pending.`,
    };
  }

  // ---------------------------------------------------------
  // Delayed retry
  // ---------------------------------------------------------
  if (action === 'retry_in_24h') {
    const retryAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();

    /*
     * We schedule the retry first.
     *
     * The actual retry is handled later by reprocessRetry().
     * Therefore the initial event remains "pending".
     */
    return {
      status: 'pending',
      amountRecovered: 0,
      retryAt,
      interventionCost: 0,
      message: 'Recovery retry scheduled for 24 hours later.',
    };
  }

  // ---------------------------------------------------------
  // Discount offer
  // ---------------------------------------------------------
  if (action === 'send_discount_offer') {
    const discountCost = paymentAmount * 0.10;

    return {
      status: 'pending',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: discountCost,
      message: 'Discount recovery offer sent; payment remains pending.',
    };
  }

  // ---------------------------------------------------------
  // Human escalation
  // ---------------------------------------------------------
  if (action === 'escalate_human') {
    return {
      status: 'stopped',
      amountRecovered: 0,
      retryAt: null,

      // Estimated operational cost of human intervention.
      interventionCost: 35,

      message: 'Recovery stopped and escalated to human support.',
    };
  }

  // ---------------------------------------------------------
  // Give up
  // ---------------------------------------------------------
  if (action === 'give_up') {
    return {
      status: 'stopped',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: 0,
      message: 'Recovery stopped according to policy.',
    };
  }

  // ---------------------------------------------------------
  // Unknown action — fail safely
  // ---------------------------------------------------------
  return {
    status: 'stopped',
    amountRecovered: 0,
    retryAt: null,
    interventionCost: 0,
    message: `Unknown action "${action}". Recovery stopped safely.`,
  };
}

/**
 * Used by the retry processor.
 *
 * Unlike the initial retry_in_24h call, this represents
 * the actual retry attempt after the scheduled delay.
 */
function executeScheduledRetry({
  amount,
  reason,
  attemptNumber = 2,
}) {
  const paymentAmount = Number(amount) || 0;

  const rule = RECOVERY_RULES[reason] || RECOVERY_RULES.unknown;

  if (rule.retry_later_success) {
    return {
      status: 'recovered',
      amountRecovered: paymentAmount,
      retryAt: null,
      interventionCost: 0,
      message: `Scheduled retry successfully recovered the payment on attempt ${attemptNumber}.`,
    };
  }

  return {
    status: 'pending',
    amountRecovered: 0,
    retryAt: new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString(),
    interventionCost: 0,
    message: `Scheduled retry did not recover the payment on attempt ${attemptNumber}.`,
  };
}

module.exports = {
  executeAction,
  executeScheduledRetry,
};