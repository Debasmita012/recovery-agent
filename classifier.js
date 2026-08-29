// Deterministic classifier - fast, no LLM call needed here.
// Maps Razorpay's error_code / error_reason to a clean reason_code + retryable flag.
function classifyFailure(payload) {
  const entity = payload?.payment?.entity || {};
  const errorCode = (entity.error_code || '').toUpperCase();
  const errorReason = (entity.error_reason || '').toLowerCase();

  if (errorReason.includes('insufficient')) {
    return { reason: 'insufficient_funds', retryable: true };
  }
  if (errorReason.includes('expired')) {
    return { reason: 'card_expired', retryable: false };
  }
  if (errorReason.includes('declined') || errorCode.includes('BAD_REQUEST_ERROR')) {
    return { reason: 'bank_declined', retryable: true };
  }
  if (errorReason.includes('invalid') || errorCode.includes('GATEWAY_ERROR')) {
    return { reason: 'invalid_card', retryable: false };
  }
  return { reason: 'unknown', retryable: true };
}

module.exports = { classifyFailure };
