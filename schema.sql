CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT,
  subscription_id TEXT,
  amount INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  razorpay_event_id TEXT UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  event_type TEXT,
  reason_code TEXT,
  action_taken TEXT,
  llm_reasoning TEXT,
  outcome TEXT,               -- 'recovered' | 'stopped' | 'pending'
  attempt_number INTEGER DEFAULT 0,
  amount_recovered INTEGER DEFAULT 0,
  retry_at TIMESTAMP,
  ruled_out_json TEXT,
  intervention_cost INTEGER DEFAULT 0,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id);
CREATE INDEX IF NOT EXISTS idx_events_retry ON events(action_taken, processed, retry_at);
