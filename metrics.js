const { pool } = require('./db');

async function getMetrics() {
  const totalRes = await pool.query('SELECT COUNT(DISTINCT customer_id)::int AS c FROM events');
  const recoveredRes = await pool.query(
    `SELECT COUNT(DISTINCT customer_id)::int AS c, COALESCE(SUM(amount_recovered),0)::int AS amt
     FROM events WHERE outcome = 'recovered'`
  );
  const stoppedRes = await pool.query(
    `SELECT COUNT(DISTINCT customer_id)::int AS c FROM events WHERE outcome = 'stopped'`
  );
  const pendingRes = await pool.query(
    `SELECT COUNT(DISTINCT customer_id)::int AS c FROM events
     WHERE outcome = 'pending' AND customer_id NOT IN (
       SELECT customer_id FROM events WHERE outcome IN ('recovered','stopped')
     )`
  );
  const avgAttemptsRes = await pool.query(
    `SELECT COALESCE(AVG(attempt_number),0)::float AS avg FROM events WHERE outcome = 'recovered'`
  );

  const costRes = await pool.query('SELECT COALESCE(SUM(intervention_cost), 0)::int AS total FROM events');
  const discountCostRes = await pool.query(
    `SELECT COALESCE(SUM(intervention_cost), 0)::int AS total FROM events WHERE action_taken = 'send_discount_offer'`
  );
  const humanCostRes = await pool.query(
    `SELECT COALESCE(SUM(intervention_cost), 0)::int AS total FROM events WHERE action_taken = 'escalate_human'`
  );

  const total = totalRes.rows[0]?.c || 0;
  const recovered = recoveredRes.rows[0] || { c: 0, amt: 0 };
  const stopped = stoppedRes.rows[0]?.c || 0;
  const pending = pendingRes.rows[0]?.c || 0;

  const grossRecovered = (recovered.amt || 0) / 100;
  const totalCost = (costRes.rows[0]?.total || 0) / 100;
  const discountCost = (discountCostRes.rows[0]?.total || 0) / 100;
  const humanCost = (humanCostRes.rows[0]?.total || 0) / 100;
  const netRecovered = grossRecovered - totalCost;

  return {
    total_customers: total,
    recovered_count: recovered.c,
    amount_recovered_inr: grossRecovered,
    total_agent_cost_inr: totalCost,
    net_recovered_inr: +netRecovered.toFixed(2),
    cost_breakdown: {
      discount_costs_inr: discountCost,
      human_escalation_costs_inr: humanCost
    },
    escalated_or_gave_up: stopped,
    still_pending: pending,
    recovery_rate_pct: total > 0 ? +((recovered.c / total) * 100).toFixed(1) : 0,
    avg_attempts_to_recovery: +(avgAttemptsRes.rows[0]?.avg || 0).toFixed(2)
  };
}

async function printMetrics() {
  const m = await getMetrics();
  console.log(JSON.stringify(m, null, 2));
  process.exit(0);
}

module.exports = { getMetrics, printMetrics };
