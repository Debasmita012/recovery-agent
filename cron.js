const cron = require('node-cron');
const { pool } = require('./db');
const { reprocessRetry } = require('./handler');


function getCronExpression() {
  /*
   * DEMO_CRON_MINUTES controls how frequently the retry
   * worker checks for due payments.
   *
   * Example:
   * DEMO_CRON_MINUTES=1
   *
   * means every minute.
   *
   * Default:
   * every 3 minutes.
   */

  const minutes = Number(
    process.env.DEMO_CRON_MINUTES
  );

  if (
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= 59
  ) {
    return `*/${minutes} * * * *`;
  }

  return '*/3 * * * *';
}


async function processDueRetries() {
  try {
    const due = await pool.query(
      `SELECT *
       FROM events
       WHERE action_taken = 'retry_in_24h'
         AND processed = false
         AND retry_at IS NOT NULL
         AND retry_at <= NOW()
       ORDER BY retry_at ASC
       LIMIT 100`
    );

    if (due.rows.length === 0) {
      return;
    }

    console.log(
      `[cron] ${due.rows.length} retry(s) due`
    );

    for (const row of due.rows) {
      try {
        await reprocessRetry(row);

        console.log(
          `[cron] Retry completed: customer=${row.customer_id}`
        );

      } catch (err) {
        console.error(
          `[cron] Retry failed: customer=${row.customer_id}`,
          err.message
        );
      }
    }

  } catch (err) {
    console.error(
      '[cron] Database query failed:',
      err.message
    );
  }
}


function startRetryCron() {
  const expression = getCronExpression();

  cron.schedule(expression, async () => {
    await processDueRetries();
  });

  console.log(
    `Retry cron started. Schedule: ${expression}`
  );
}


module.exports = {
  startRetryCron,
  processDueRetries,
};