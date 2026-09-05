/**
 * Payment Recovery Executor
 *
 * Supports two modes:
 *
 * 1. DEMO
 *    - Uses deterministic simulation rules.
 *    - Does not contact Razorpay.
 *
 * 2. RAZORPAY_TEST
 *    - Reserved for Razorpay Test Mode integration.
 *    - Uses Razorpay credentials from .env.
 *
 * Current default:
 * PAYMENT_EXECUTION_MODE=demo
 */

const Razorpay = require('razorpay');


// ============================================================
// CONFIGURATION
// ============================================================

const EXECUTION_MODE =
  (process.env.PAYMENT_EXECUTION_MODE || 'demo')
    .trim()
    .toLowerCase();


// ============================================================
// RAZORPAY CLIENT
// ============================================================

let razorpay = null;

if (
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET
) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}


// ============================================================
// DEMO RECOVERY RULES
// ============================================================

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


// ============================================================
// RETRY DELAY
// ============================================================

function getRetryDelayMinutes() {
  const configured = Number(
    process.env.DEMO_RETRY_DELAY_MINUTES
  );

  if (
    Number.isFinite(configured) &&
    configured >= 0
  ) {
    return configured;
  }

  return 24 * 60;
}


// ============================================================
// DEMO EXECUTOR
// ============================================================

function executeDemoAction({
  action,
  amount,
  reason,
  attemptNumber = 1,
}) {
  const paymentAmount =
    Number(amount) || 0;

  const rule =
    RECOVERY_RULES[reason] ||
    RECOVERY_RULES.unknown;


  // ----------------------------------------------------------
  // Immediate retry
  // ----------------------------------------------------------

  if (action === 'retry_now') {
    const recovered =
      Boolean(rule.retry_now_success);

    if (recovered) {
      return {
        status: 'recovered',
        amountRecovered: paymentAmount,
        retryAt: null,
        interventionCost: 0,
        message:
          `Demo payment recovered successfully on immediate retry at attempt ${attemptNumber}.`,
      };
    }

    return {
      status: 'pending',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: 0,
      message:
        'Demo immediate retry did not recover the payment; recovery remains pending.',
    };
  }


  // ----------------------------------------------------------
  // Delayed retry
  // ----------------------------------------------------------

  if (action === 'retry_in_24h') {
    const delayMinutes =
      getRetryDelayMinutes();

    const retryAt =
      new Date(
        Date.now() +
        delayMinutes * 60 * 1000
      ).toISOString();

    return {
      status: 'pending',
      amountRecovered: 0,
      retryAt,
      interventionCost: 0,
      message:
        `Demo recovery retry scheduled in ${delayMinutes} minute(s).`,
    };
  }


  // ----------------------------------------------------------
  // Discount
  // ----------------------------------------------------------

  if (action === 'send_discount_offer') {
    const discountCost =
      paymentAmount * 0.10;

    return {
      status: 'pending',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: discountCost,
      message:
        'Demo discount recovery offer sent; payment remains pending.',
    };
  }


  // ----------------------------------------------------------
  // Human escalation
  // ----------------------------------------------------------

  if (action === 'escalate_human') {
    return {
      status: 'stopped',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: 35,
      message:
        'Demo recovery stopped and escalated to human support.',
    };
  }


  // ----------------------------------------------------------
  // Give up
  // ----------------------------------------------------------

  if (action === 'give_up') {
    return {
      status: 'stopped',
      amountRecovered: 0,
      retryAt: null,
      interventionCost: 0,
      message:
        'Demo recovery stopped according to policy.',
    };
  }


  // ----------------------------------------------------------
  // Unknown action
  // ----------------------------------------------------------

  return {
    status: 'stopped',
    amountRecovered: 0,
    retryAt: null,
    interventionCost: 0,
    message:
      `Unknown action "${action}". Recovery stopped safely.`,
  };
}


// ============================================================
// DEMO SCHEDULED RETRY
// ============================================================

function executeDemoScheduledRetry({
  amount,
  reason,
  attemptNumber = 2,
}) {
  const paymentAmount =
    Number(amount) || 0;

  const rule =
    RECOVERY_RULES[reason] ||
    RECOVERY_RULES.unknown;


  if (rule.retry_later_success) {
    return {
      status: 'recovered',
      amountRecovered: paymentAmount,
      retryAt: null,
      interventionCost: 0,
      message:
        `Demo scheduled retry successfully recovered the payment on attempt ${attemptNumber}.`,
    };
  }


  return {
    status: 'pending',
    amountRecovered: 0,
    retryAt:
      new Date(
        Date.now() +
        getRetryDelayMinutes() * 60 * 1000
      ).toISOString(),
    interventionCost: 0,
    message:
      `Demo scheduled retry did not recover the payment on attempt ${attemptNumber}.`,
  };
}


// ============================================================
// RAZORPAY TEST MODE PLACEHOLDER
// ============================================================

function assertRazorpayConfigured() {
  if (!razorpay) {
    throw new Error(
      'Razorpay Test Mode is not configured. ' +
      'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.'
    );
  }
}


// ============================================================
// MAIN EXECUTOR
// ============================================================

function executeAction({
  action,
  amount,
  reason,
  attemptNumber = 1,
  razorpayPaymentId = null,
  razorpayOrderId = null,
  razorpaySubscriptionId = null,
}) {

  if (EXECUTION_MODE === 'demo') {
    return executeDemoAction({
      action,
      amount,
      reason,
      attemptNumber,
    });
  }


  if (
    EXECUTION_MODE === 'razorpay_test' ||
    EXECUTION_MODE === 'test'
  ) {
    assertRazorpayConfigured();

    /*
     * IMPORTANT:
     *
     * The actual Razorpay retry cannot be performed yet
     * because this function currently receives only:
     *
     * amount
     * reason
     * action
     * attemptNumber
     *
     * We need the original Razorpay payment/order ID.
     *
     * Step 4 will add those identifiers to handler.js and
     * pass them into this executor.
     */

    throw new Error(
      'Razorpay Test Mode is configured but payment identifiers ' +
      'have not yet been connected to the executor.'
    );
  }


  throw new Error(
    `Unknown PAYMENT_EXECUTION_MODE: ${EXECUTION_MODE}`
  );
}


// ============================================================
// SCHEDULED RETRY EXECUTOR
// ============================================================

function executeScheduledRetry({
  amount,
  reason,
  attemptNumber = 2,
  razorpayPaymentId = null,
  razorpayOrderId = null,
  razorpaySubscriptionId = null,
}) {

  if (EXECUTION_MODE === 'demo') {
    return executeDemoScheduledRetry({
      amount,
      reason,
      attemptNumber,
    });
  }


  if (
    EXECUTION_MODE === 'razorpay_test' ||
    EXECUTION_MODE === 'test'
  ) {
    assertRazorpayConfigured();

    throw new Error(
      'Razorpay Test Mode scheduled retry requires the original ' +
      'Razorpay payment/order identifier. This will be connected in Step 4.'
    );
  }


  throw new Error(
    `Unknown PAYMENT_EXECUTION_MODE: ${EXECUTION_MODE}`
  );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  executeAction,
  executeScheduledRetry,
};