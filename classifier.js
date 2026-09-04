/**
 * Deterministic payment failure classifier.
 *
 * Supports both:
 *
 * 1. Full webhook payload:
 *    {
 *      payment: {
 *        entity: {
 *          error_code,
 *          error_reason
 *        }
 *      }
 *    }
 *
 * 2. Inner payment payload:
 *    {
 *      entity: {
 *        error_code,
 *        error_reason
 *      }
 *    }
 *
 * 3. Direct payment entity:
 *    {
 *      error_code,
 *      error_reason
 *    }
 *
 * This makes the classifier tolerant to small differences
 * in webhook-handler payload structure.
 */

function classifyFailure(input) {
  // ---------------------------------------------------------
  // Normalize the input to the Razorpay payment entity
  // ---------------------------------------------------------

  const entity =
    input?.payment?.entity ||
    input?.entity ||
    input?.payment ||
    input ||
    {};


  const errorCode =
    String(entity.error_code || '').toUpperCase();

  const errorReason =
    String(entity.error_reason || '').toLowerCase();


  // ---------------------------------------------------------
  // Insufficient funds
  // ---------------------------------------------------------

  if (
    errorReason.includes('insufficient') ||
    errorReason.includes('insufficient funds')
  ) {
    return {
      reason: 'insufficient_funds',
      retryable: true,
    };
  }


  // ---------------------------------------------------------
  // Expired card
  // ---------------------------------------------------------

  if (
    errorReason.includes('expired') ||
    errorReason.includes('card has expired')
  ) {
    return {
      reason: 'card_expired',
      retryable: false,
    };
  }


  // ---------------------------------------------------------
  // Bank decline
  // ---------------------------------------------------------

  if (
    errorReason.includes('declined') ||
    errorReason.includes('bank declined') ||
    errorCode.includes('BAD_REQUEST_ERROR')
  ) {
    return {
      reason: 'bank_declined',
      retryable: true,
    };
  }


  // ---------------------------------------------------------
  // Invalid card
  // ---------------------------------------------------------

  if (
    errorReason.includes('invalid') ||
    errorReason.includes('invalid card') ||
    errorCode.includes('GATEWAY_ERROR')
  ) {
    return {
      reason: 'invalid_card',
      retryable: false,
    };
  }


  // ---------------------------------------------------------
  // Unknown failure
  // ---------------------------------------------------------

  return {
    reason: 'unknown',
    retryable: true,
  };
}


module.exports = {
  classifyFailure,
};