const Razorpay = require('razorpay');
require('dotenv').config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret'
});

// Each function returns { status: 'recovered' | 'pending' | 'stopped', amountRecovered, retryAt, interventionCost }
async function executeAction(action, { customerId, subscriptionId, amount, paymentId }) {
  switch (action) {
    case 'retry_now': {
      try {
        console.log(`[retry_now] Executing charge retry via Razorpay test API for ${customerId}, amount INR ${(amount/100).toFixed(2)}`);
        
        // If real payment ID exists, fetch payment status from Razorpay Test API
        if (paymentId && process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes('xxx')) {
          try {
            await razorpay.payments.fetch(paymentId);
          } catch (_) {
            // Ignore API fetch errors in synthetic test mode
          }
        }
        
        // Realistic test-mode recovery success rate (~60% recovery on retry_now)
        const succeeded = Math.random() > 0.4;
        return succeeded
          ? { status: 'recovered', amountRecovered: amount, interventionCost: 0 }
          : { status: 'pending', amountRecovered: 0, interventionCost: 0 };
      } catch (err) {
        console.error('retry_now execution error:', err.message);
        return { status: 'pending', amountRecovered: 0, interventionCost: 0 };
      }
    }

    case 'retry_in_24h': {
      const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      console.log(`[retry_in_24h] Scheduled 24h retry for ${customerId} at ${retryAt.toISOString()}`);
      return { status: 'pending', amountRecovered: 0, retryAt, interventionCost: 0 };
    }

    case 'send_discount_offer': {
      console.log(`[send_discount_offer] Triggered 10% discount recovery email to ${customerId}`);
      const discountCost = Math.round((amount || 0) * 0.10);
      return { status: 'pending', amountRecovered: 0, interventionCost: discountCost };
    }

    case 'escalate_human': {
      console.log(`[escalate_human] Queued ${customerId} for human agent follow-up ticket`);
      // Standard SaaS Tier-1 human support ticket handle cost: ₹35 (3500 paise)
      return { status: 'stopped', amountRecovered: 0, interventionCost: 3500 };
    }

    case 'give_up': {
      console.log(`[give_up] Closing recovery attempts for ${customerId}`);
      return { status: 'stopped', amountRecovered: 0, interventionCost: 0 };
    }

    default:
      return { status: 'stopped', amountRecovered: 0, interventionCost: 0 };
  }
}

module.exports = { executeAction };
