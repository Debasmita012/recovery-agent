const cron = require('node-cron');
const { pool } = require('./db');
const { reprocessRetry } = require('./handler');

function startRetryCron() {
  // Every 3 minutes - fine-grained enough for a live demo, cheap enough to run constantly.
  cron.schedule('*/3 * * * *', async () => {
    const due = await pool.query(
      `SELECT * FROM events
       WHERE action_taken = 'retry_in_24h' AND processed = false AND retry_at <= now()`
    );
    if (due.rows.length === 0) return;
    console.log(`Cron: ${due.rows.length} retries due`);
    for (const row of due.rows) {
      await reprocessRetry(row).catch(err => console.error('Retry reprocess failed:', err.message));
    }
  });
  console.log('Retry cron started.');
}

module.exports = { startRetryCron };
