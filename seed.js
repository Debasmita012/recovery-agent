const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'secret123';

// Mix of failure reasons so your batch has a realistic spread for the metrics.
const REASON_PROFILES = [
  { error_reason: 'insufficient funds in account', error_code: 'BAD_REQUEST_ERROR' },
  { error_reason: 'card has expired', error_code: 'GATEWAY_ERROR' },
  { error_reason: 'payment declined by bank', error_code: 'BAD_REQUEST_ERROR' },
  { error_reason: 'invalid card number', error_code: 'GATEWAY_ERROR' }
];

function signPayload(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function buildPayload(customerId, amount, profile) {
  return {
    event: 'payment.failed',
    event_id: `evt_${customerId}_${Date.now()}`,
    payload: {
      payment: {
        entity: {
          id: `pay_${customerId}`,
          amount,
          currency: 'INR',
          error_code: profile.error_code,
          error_reason: profile.error_reason,
          notes: { customer_id: customerId }
        }
      }
    }
  };
}

async function seedBatch(n = 40) {
  console.log(`Seeding ${n} synthetic failed payments against ${BASE_URL}/webhook ...`);

  for (let i = 0; i < n; i++) {
    const customerId = `cust_${i}`;
    const amount = 49900 + (i % 5) * 10000; // paise, so ~499 to ~899 INR
    const profile = REASON_PROFILES[i % REASON_PROFILES.length];
    const payload = buildPayload(customerId, amount, profile);
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    try {
      await axios.post(`${BASE_URL}/webhook`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature
        }
      });
      console.log(`  sent failure for ${customerId} (${profile.error_reason})`);
    } catch (err) {
      console.error(`  failed to send for ${customerId}:`, err.message);
    }

    // Small delay so you can watch it stream in in the dashboard during a live demo.
    await new Promise(r => setTimeout(r, 150));
  }

  console.log('Seeding complete. Check /metrics and /customers.');
}

seedBatch(Number(process.argv[2]) || 40);
