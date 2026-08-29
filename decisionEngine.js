const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' });

// Fixed, bounded action menu - the LLM can never choose outside this list.
const ACTIONS = ['retry_now', 'retry_in_24h', 'send_discount_offer', 'escalate_human', 'give_up'];
const MAX_ATTEMPTS = 3;
const MAX_DISCOUNT_PCT = 10;

function buildRuledOutAnalysis({ chosenAction, reasonCode, attemptNumber, retryable }) {
  const analysis = [];

  for (const act of ACTIONS) {
    if (act === chosenAction) {
      analysis.push({
        action: act,
        status: 'SELECTED',
        reason: 'Optimal action chosen by decision engine after rule evaluation.'
      });
      continue;
    }

    if (act === 'retry_now' || act === 'retry_in_24h') {
      if (attemptNumber >= MAX_ATTEMPTS) {
        analysis.push({
          action: act,
          status: 'BLOCKED',
          reason: `Safety Gate: Max retry attempts (${MAX_ATTEMPTS}) reached.`
        });
        continue;
      }
      if (reasonCode === 'card_expired' || reasonCode === 'invalid_card' || !retryable) {
        analysis.push({
          action: act,
          status: 'BLOCKED',
          reason: `Safety Gate: Reason '${reasonCode}' is permanently non-retryable.`
        });
        continue;
      }
    }

    if (act === 'send_discount_offer' && (reasonCode === 'card_expired' || reasonCode === 'invalid_card')) {
      analysis.push({
        action: act,
        status: 'REJECTED',
        reason: 'Discount offer ineffective for an expired or invalid card.'
      });
      continue;
    }

    if (act === 'give_up' && (chosenAction.startsWith('retry') || chosenAction === 'send_discount_offer')) {
      analysis.push({
        action: act,
        status: 'REJECTED',
        reason: 'Active recovery attempt prioritized over prematurely giving up.'
      });
      continue;
    }

    analysis.push({
      action: act,
      status: 'REJECTED',
      reason: `Alternative action ruled out in favor of ${chosenAction}.`
    });
  }

  return analysis;
}

async function decideAction({ reasonCode, retryable, attemptNumber, amount }) {
  const prompt = `You are a payment recovery agent for a subscription business.
Given this failed payment, choose exactly one action from this list: ${ACTIONS.join(', ')}.

Failure reason: ${reasonCode}
Retryable by nature: ${retryable}
Attempts so far: ${attemptNumber}
Amount: INR ${(amount / 100).toFixed(2)}

Hard rules you must follow:
- Never choose a retry action if attempts so far is ${MAX_ATTEMPTS} or more.
- If reason is card_expired or invalid_card, never retry - escalate_human or give_up only.
- A discount offer must never exceed ${MAX_DISCOUNT_PCT}% of the amount, and should only be used when it is likely to change the outcome (e.g. insufficient_funds, first attempt).
- Prefer the least aggressive action that is still likely to work.

Respond with ONLY valid JSON, no markdown fences, in this exact shape:
{"action": "one_of_the_actions_above", "reasoning": "one short sentence explaining why"}`;

  let parsed;
  try {
    if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('xxxx')) {
      const res = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      });
      const raw = res.content.find(b => b.type === 'text')?.text?.trim() || '{}';
      const cleaned = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } else {
      parsed = getFallbackDecision({ reasonCode, retryable, attemptNumber, amount });
    }
  } catch (err) {
    console.warn(`[decisionEngine] LLM decision error (${err.message}). Using fallback rules.`);
    parsed = getFallbackDecision({ reasonCode, retryable, attemptNumber, amount });
  }

  // Server-side validation - never trust the LLM output blindly.
  if (!parsed || !ACTIONS.includes(parsed.action)) {
    parsed = { action: 'escalate_human', reasoning: 'Fallback: model returned an invalid action.' };
  }
  if (attemptNumber >= MAX_ATTEMPTS && parsed.action.startsWith('retry')) {
    parsed = { action: 'escalate_human', reasoning: `Fallback: max attempts (${MAX_ATTEMPTS}) reached.` };
  }
  if ((reasonCode === 'card_expired' || reasonCode === 'invalid_card') && parsed.action.startsWith('retry')) {
    parsed = { action: 'escalate_human', reasoning: 'Fallback: non-retryable failure reason.' };
  }

  parsed.ruledOutActions = buildRuledOutAnalysis({
    chosenAction: parsed.action,
    reasonCode,
    attemptNumber,
    retryable
  });

  return parsed;
}

function getFallbackDecision({ reasonCode, retryable, attemptNumber }) {
  if (attemptNumber >= MAX_ATTEMPTS) {
    return { action: 'escalate_human', reasoning: `Rule Engine: max attempts (${MAX_ATTEMPTS}) reached.` };
  }
  if (reasonCode === 'card_expired' || reasonCode === 'invalid_card' || !retryable) {
    return { action: 'escalate_human', reasoning: `Rule Engine: failure reason (${reasonCode}) is non-retryable.` };
  }
  if (reasonCode === 'insufficient_funds') {
    if (attemptNumber === 0) {
      return { action: 'retry_in_24h', reasoning: 'Rule Engine: insufficient funds; schedule retry in 24h.' };
    } else {
      return { action: 'send_discount_offer', reasoning: 'Rule Engine: insufficient funds on retry; send discount offer.' };
    }
  }
  if (reasonCode === 'bank_declined') {
    return { action: 'retry_now', reasoning: 'Rule Engine: bank declined transiently; attempt immediate retry.' };
  }
  return { action: 'escalate_human', reasoning: 'Rule Engine: unhandled failure pattern; escalate to human.' };
}

module.exports = { decideAction, ACTIONS, MAX_ATTEMPTS, buildRuledOutAnalysis };
