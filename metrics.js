const { pool } = require('./db');

async function getMetrics() {

  // ============================================================
  // TOTAL CUSTOMERS / REVENUE AT RISK
  // ============================================================

  const customerRes = await pool.query(
    `SELECT
       COUNT(*)::int AS customer_count,
       COALESCE(SUM(amount), 0)::bigint AS revenue_at_risk
     FROM customers`
  );


  // ============================================================
  // RECOVERED CUSTOMERS + RECOVERED REVENUE
  //
  // IMPORTANT:
  // There can be duplicate recovered event rows for the same
  // customer. We therefore select only ONE recovered event per
  // customer before summing amount_recovered.
  // ============================================================

  const recoveredRes = await pool.query(
    `SELECT
       COUNT(*)::int AS c,
       COALESCE(SUM(amount_recovered), 0)::bigint AS amt
     FROM (
       SELECT DISTINCT ON (customer_id)
         customer_id,
         amount_recovered
       FROM events
       WHERE outcome = 'recovered'
       ORDER BY customer_id, created_at DESC, id DESC
     ) recovered_events`
  );


  // ============================================================
  // STOPPED / ESCALATED CUSTOMERS
  // ============================================================

  const stoppedRes = await pool.query(
    `SELECT COUNT(DISTINCT customer_id)::int AS c
     FROM events
     WHERE outcome = 'stopped'`
  );


  // ============================================================
  // STILL PENDING
  // ============================================================

  const pendingRes = await pool.query(
    `SELECT COUNT(DISTINCT customer_id)::int AS c
     FROM events
     WHERE outcome = 'pending'
       AND customer_id NOT IN (
         SELECT DISTINCT customer_id
         FROM events
         WHERE outcome IN ('recovered', 'stopped')
       )`
  );


  // ============================================================
  // AVERAGE ATTEMPTS TO RECOVERY
  //
  // Use one successful recovery event per customer so duplicate
  // rows don't distort the average.
  // ============================================================

  const avgAttemptsRes = await pool.query(
    `SELECT
       COALESCE(AVG(attempt_number), 0)::float AS avg
     FROM (
       SELECT DISTINCT ON (customer_id)
         customer_id,
         attempt_number
       FROM events
       WHERE outcome = 'recovered'
       ORDER BY customer_id, created_at DESC, id DESC
     ) recovered_attempts`
  );


  // ============================================================
  // TOTAL AGENT COST
  // ============================================================

  const costRes = await pool.query(
    `SELECT
       COALESCE(SUM(intervention_cost), 0)::int AS total
     FROM events`
  );


  // ============================================================
  // DISCOUNT COST
  // ============================================================

  const discountCostRes = await pool.query(
    `SELECT
       COALESCE(SUM(intervention_cost), 0)::int AS total
     FROM events
     WHERE action_taken = 'send_discount_offer'`
  );


  // ============================================================
  // HUMAN ESCALATION COST
  // ============================================================

  const humanCostRes = await pool.query(
    `SELECT
       COALESCE(SUM(intervention_cost), 0)::int AS total
     FROM events
     WHERE action_taken = 'escalate_human'`
  );


  // ============================================================
  // NORMALIZE DATABASE VALUES
  // ============================================================

  const total =
    Number(customerRes.rows[0]?.customer_count || 0);

  const revenueAtRisk =
    Number(customerRes.rows[0]?.revenue_at_risk || 0) / 100;

  const recovered =
    recoveredRes.rows[0] || {
      c: 0,
      amt: 0
    };

  const recoveredCount =
    Number(recovered.c || 0);

  const grossRecovered =
    Number(recovered.amt || 0) / 100;

  const stopped =
    Number(stoppedRes.rows[0]?.c || 0);

  const pending =
    Number(pendingRes.rows[0]?.c || 0);

  const totalCost =
    Number(costRes.rows[0]?.total || 0) / 100;

  const discountCost =
    Number(discountCostRes.rows[0]?.total || 0) / 100;

  const humanCost =
    Number(humanCostRes.rows[0]?.total || 0) / 100;


  // ============================================================
  // NET VALUE CREATED
  // ============================================================

  const netValueCreated =
    grossRecovered - totalCost;


  // ============================================================
  // CUSTOMER RECOVERY RATE
  // ============================================================

  const recoveryRate =
    total > 0
      ? (recoveredCount / total) * 100
      : 0;


  // ============================================================
  // REVENUE RECOVERY RATE
  // ============================================================

  const revenueRecoveryRate =
    revenueAtRisk > 0
      ? (grossRecovered / revenueAtRisk) * 100
      : 0;


  // ============================================================
  // ROI
  // ============================================================

  const roi =
    totalCost > 0
      ? (netValueCreated / totalCost) * 100
      : 0;


  // ============================================================
  // FINAL RESPONSE
  // ============================================================

  return {

    // Customer metrics
    total_customers: total,

    recovered_count:
      recoveredCount,

    escalated_or_gave_up:
      stopped,

    still_pending:
      pending,


    // Revenue metrics
    revenue_at_risk_inr:
      +revenueAtRisk.toFixed(2),

    amount_recovered_inr:
      +grossRecovered.toFixed(2),

    revenue_recovered_inr:
      +grossRecovered.toFixed(2),

    recovery_rate_pct:
      +recoveryRate.toFixed(1),

    revenue_recovery_rate_pct:
      +revenueRecoveryRate.toFixed(1),


    // Economics
    total_agent_cost_inr:
      +totalCost.toFixed(2),

    net_recovered_inr:
      +netValueCreated.toFixed(2),

    net_value_created_inr:
      +netValueCreated.toFixed(2),

    roi_pct:
      +roi.toFixed(1),


    // Cost breakdown
    cost_breakdown: {

      discount_costs_inr:
        +discountCost.toFixed(2),

      human_escalation_costs_inr:
        +humanCost.toFixed(2)
    },


    // Operations
    avg_attempts_to_recovery:
      +(avgAttemptsRes.rows[0]?.avg || 0).toFixed(2)
  };
}


async function printMetrics() {

  const m = await getMetrics();

  console.log(
    JSON.stringify(
      m,
      null,
      2
    )
  );

  process.exit(0);
}


module.exports = {
  getMetrics,
  printMetrics
};