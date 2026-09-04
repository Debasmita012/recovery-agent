const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
require('dotenv').config();

const rawUrl = process.argv[3] || process.env.BASE_URL || 'http://localhost:3000';
let BASE_URL = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

// If targeting Railway domain that has ISP DNS blocks, route via Railway Edge IP 69.46.46.79
let targetHost = '';
if (BASE_URL.includes('up.railway.app')) {
  try {
    const urlObj = new URL(BASE_URL);
    targetHost = urlObj.hostname;
    BASE_URL = `${urlObj.protocol}//69.46.46.79`;
  } catch (_) {}
}

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'Ne3_ziwgWtbqLFv';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  servername: targetHost || undefined
});

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

    const headers = {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature
    };
    if (targetHost) {
      headers['Host'] = targetHost;
    }

    try {
      await axios.post(`${BASE_URL}/webhook`, payload, {
        headers,
        httpsAgent: targetHost ? httpsAgent : undefined
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
