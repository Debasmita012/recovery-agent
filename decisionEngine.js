const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ============================================================
// BOUNDED ACTION MENU
// Claude is NEVER allowed to invent an action.
// ============================================================

const ACTIONS = [
  'retry_now',
  'retry_in_24h',
  'send_discount_offer',
  'escalate_human',
  'give_up'
];

const MAX_ATTEMPTS = 3;
const MAX_DISCOUNT_PCT = 10;


// ============================================================
// DETERMINISTIC FALLBACK
//
// This is used if:
// - Claude API is unavailable
// - API key is missing
// - Claude returns invalid JSON
// - Claude returns an invalid action
//
// IMPORTANT:
// We do NOT automatically escalate every case.
// We use the known failure reason to choose a safe action.
// ============================================================

function fallbackDecision({
  reasonCode,
  retryable,
  attemptNumber
}) {

  // ----------------------------------------------------------
  // RULE 1: Maximum attempts reached
  // ----------------------------------------------------------

  if (attemptNumber >= MAX_ATTEMPTS) {
    return {
      action: 'escalate_human',
      reasoning:
        `Maximum retry attempts (${MAX_ATTEMPTS}) reached; human review required.`,
      decision_source: 'fallback_policy'
    };
  }


  // ----------------------------------------------------------
  // RULE 2: Non-retryable payment methods
  // ----------------------------------------------------------

  if (reasonCode === 'card_expired') {
    return {
      action: 'escalate_human',
      reasoning:
        'Card is expired, so retrying the same payment is unlikely to succeed.',
      decision_source: 'fallback_policy'
    };
  }


  if (reasonCode === 'invalid_card') {
    return {
      action: 'escalate_human',
      reasoning:
        'Card details are invalid, so the payment method needs correction.',
      decision_source: 'fallback_policy'
    };
  }


  // ----------------------------------------------------------
  // RULE 3: Insufficient funds
  //
  // Immediate retry is usually less useful.
  // A delayed retry is safer.
  // ----------------------------------------------------------

  if (reasonCode === 'insufficient_funds') {
    return {
      action: 'retry_in_24h',
      reasoning:
        'Insufficient funds may be temporary, so a delayed retry is safer than an immediate retry.',
      decision_source: 'fallback_policy'
    };
  }


  // ----------------------------------------------------------
  // RULE 4: Bank declined
  //
  // First failure:
  //     retry_now
  //
  // Later failure:
  //     retry_in_24h
  // ----------------------------------------------------------

  if (reasonCode === 'bank_declined') {

    if (attemptNumber === 0) {
      return {
        action: 'retry_now',
        reasoning:
          'This is the first bank decline, so one immediate retry is appropriate.',
        decision_source: 'fallback_policy'
      };
    }

    return {
      action: 'retry_in_24h',
      reasoning:
        'The payment has already been attempted, so a delayed retry avoids repeated immediate attempts.',
      decision_source: 'fallback_policy'
    };
  }


  // ----------------------------------------------------------
  // RULE 5: Unknown but retryable
  // ----------------------------------------------------------

  if (retryable) {

    if (attemptNumber === 0) {
      return {
        action: 'retry_now',
        reasoning:
          'The failure is retryable and this is the first recovery attempt.',
        decision_source: 'fallback_policy'
      };
    }

    return {
      action: 'retry_in_24h',
      reasoning:
        'The failure is retryable, but a delayed retry is safer after a previous attempt.',
      decision_source: 'fallback_policy'
    };
  }


  // ----------------------------------------------------------
  // FINAL SAFE FALLBACK
  // ----------------------------------------------------------

  return {
    action: 'escalate_human',
    reasoning:
      'The failure could not be safely recovered automatically and requires human review.',
    decision_source: 'fallback_policy'
  };
}


// ============================================================
// MAIN AI DECISION ENGINE
// ============================================================

async function decideAction({
  reasonCode,
  retryable,
  attemptNumber,
  amount
}) {

  console.log(
    `[decision] reason=${reasonCode}, retryable=${retryable}, attempts=${attemptNumber}, amount=${amount}`
  );


  // ==========================================================
  // SERVER-SIDE SAFETY RULES BEFORE AI
  //
  // These rules cannot be overridden by Claude.
  // ==========================================================

  if (attemptNumber >= MAX_ATTEMPTS) {

    return {
      action: 'escalate_human',
      reasoning:
        `Maximum retry attempts (${MAX_ATTEMPTS}) reached; further automatic recovery is blocked.`,
      decision_source: 'safety_policy'
    };
  }


  if (
    reasonCode === 'card_expired' ||
    reasonCode === 'invalid_card'
  ) {

    return {
      action: 'escalate_human',
      reasoning:
        `${reasonCode} is non-retryable; the payment method must be corrected before another attempt.`,
      decision_source: 'safety_policy'
    };
  }


  // ==========================================================
  // IF CLAUDE API KEY IS MISSING
  //
  // Keep the recovery engine functional using the deterministic
  // policy instead of escalating everything.
  // ==========================================================

  if (!process.env.ANTHROPIC_API_KEY) {

    console.warn(
      '[decision] ANTHROPIC_API_KEY missing. Using fallback policy.'
    );

    return fallbackDecision({
      reasonCode,
      retryable,
      attemptNumber
    });
  }


  // ==========================================================
  // AI PROMPT
  // ==========================================================

  const prompt = `
You are an AI payment recovery decision agent.

Your job is to choose the safest and most effective recovery action
for a failed payment.

You MUST choose exactly ONE action from this list:

${ACTIONS.join(', ')}

Payment context:

Failure reason: ${reasonCode}
Retryable by nature: ${retryable}
Attempts already made: ${attemptNumber}
Amount in INR: ${(amount / 100).toFixed(2)}

Hard safety rules:

1. Never choose a retry action when attempts already made
   are ${MAX_ATTEMPTS} or more.

2. Never retry card_expired.

3. Never retry invalid_card.

4. For insufficient_funds, prefer retry_in_24h.

5. For a first bank_declined failure, retry_now is acceptable.

6. For repeated bank_declined failures, prefer retry_in_24h.

7. send_discount_offer should only be selected when it could
   reasonably improve recovery.

8. Never invent an action outside the allowed list.

9. Prefer the least aggressive action that still has a reasonable
   chance of recovering the payment.

10. Give one short explanation.

Return ONLY valid JSON in exactly this format:

{
  "action": "retry_now",
  "reasoning": "Short explanation."
}

The action must be exactly one of:

${ACTIONS.join(', ')}
`;


  // ==========================================================
  // CALL CLAUDE
  // ==========================================================

  let response;

  try {

    response = await client.messages.create({

      /*
       * The model is configurable through .env.
       *
       * Example:
       * ANTHROPIC_MODEL=your-supported-model
       *
       * This avoids hardcoding an unavailable model.
       */

      model:
        process.env.ANTHROPIC_MODEL ||
        'claude-sonnet-4-5',

      max_tokens: 200,

      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

  } catch (error) {

    console.error(
      '[decision] Claude API error:',
      error.message
    );

    console.warn(
      '[decision] Falling back to deterministic recovery policy.'
    );

    return fallbackDecision({
      reasonCode,
      retryable,
      attemptNumber
    });
  }


  // ==========================================================
  // EXTRACT CLAUDE TEXT
  // ==========================================================

  let rawText = '';

  try {

    rawText =
      response.content
        ?.filter(block => block.type === 'text')
        ?.map(block => block.text)
        ?.join('\n')
        ?.trim() || '';

  } catch (error) {

    console.error(
      '[decision] Could not extract Claude response:',
      error.message
    );

    return fallbackDecision({
      reasonCode,
      retryable,
      attemptNumber
    });
  }


  console.log(
    '[decision] Claude raw response:',
    rawText
  );


  // ==========================================================
  // CLEAN MARKDOWN FENCES
  // ==========================================================

  const cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();


  // ==========================================================
  // PARSE JSON
  // ==========================================================

  let parsed;

  try {

    parsed = JSON.parse(cleaned);

  } catch (error) {

    console.error(
      '[decision] Claude returned invalid JSON.'
    );

    console.error(
      '[decision] Raw response:',
      rawText
    );

    return fallbackDecision({
      reasonCode,
      retryable,
      attemptNumber
    });
  }


  // ==========================================================
  // VALIDATE BASIC STRUCTURE
  // ==========================================================

  if (
    !parsed ||
    typeof parsed.action !== 'string'
  ) {

    console.warn(
      '[decision] Claude response does not contain a valid action.'
    );

    return fallbackDecision({
      reasonCode,
      retryable,
      attemptNumber
    });
  }


  // ==========================================================
  // VALIDATE ACTION AGAINST FIXED MENU
  // ==========================================================

  if (!ACTIONS.includes(parsed.action)) {

    console.warn(
      `[decision] Claude selected invalid action: ${parsed.action}`
    );

    return fallbackDecision({
      reasonCode,
      retryable,
      attemptNumber
    });
  }


  // ==========================================================
  // SERVER-SIDE SAFETY GATE #1
  //
  // Claude is NOT trusted blindly.
  // ==========================================================

  if (
    attemptNumber >= MAX_ATTEMPTS &&
    parsed.action.startsWith('retry')
  ) {

    console.warn(
      '[safety] Claude retry blocked: maximum attempts reached.'
    );

    return {
      action: 'escalate_human',
      reasoning:
        `AI decision blocked by safety policy: maximum retry attempts (${MAX_ATTEMPTS}) reached.`,
      decision_source: 'safety_override'
    };
  }


  // ==========================================================
  // SERVER-SIDE SAFETY GATE #2
  //
  // Expired/invalid cards cannot be retried.
  // ==========================================================

  if (
    (
      reasonCode === 'card_expired' ||
      reasonCode === 'invalid_card'
    ) &&
    parsed.action.startsWith('retry')
  ) {

    console.warn(
      `[safety] Claude retry blocked for ${reasonCode}.`
    );

    return {
      action: 'escalate_human',
      reasoning:
        `AI decision blocked by safety policy: ${reasonCode} is non-retryable.`,
      decision_source: 'safety_override'
    };
  }


  // ==========================================================
  // SERVER-SIDE SAFETY GATE #3
  //
  // Do not allow inappropriate discounts.
  // ==========================================================

  if (parsed.action === 'send_discount_offer') {

    if (
      reasonCode !== 'insufficient_funds' ||
      attemptNumber > 0
    ) {

      console.warn(
        '[safety] Discount offer blocked by recovery policy.'
      );

      return {
        action: 'retry_in_24h',
        reasoning:
          'Discount offer was not appropriate under the recovery policy; delayed retry selected instead.',
        decision_source: 'safety_override'
      };
    }
  }


  // ==========================================================
  // FINAL RESULT
  // ==========================================================

  return {
    action: parsed.action,

    reasoning:
      typeof parsed.reasoning === 'string' &&
      parsed.reasoning.trim().length > 0
        ? parsed.reasoning.trim()
        : 'Action selected based on payment failure context.',

    decision_source: 'claude'
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  decideAction,
  ACTIONS,
  MAX_ATTEMPTS,
  MAX_DISCOUNT_PCT
};