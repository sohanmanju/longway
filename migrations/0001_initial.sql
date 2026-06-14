CREATE TABLE cars (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats > 0 AND seats <= 20),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guild_id, owner_user_id, name_key)
);

CREATE TABLE cycles (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  board_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guild_id, channel_id, cycle_date)
);

CREATE TABLE ride_offers (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  car_id TEXT NOT NULL REFERENCES cars(id),
  owner_user_id TEXT NOT NULL,
  car_name TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats > 0 AND seats <= 20),
  trip_type TEXT NOT NULL CHECK (trip_type IN ('morning', 'return', 'both')),
  morning_time TEXT,
  return_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating', 'active', 'cancelled', 'failed')),
  thread_id TEXT,
  ride_card_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX active_offer_by_owner
  ON ride_offers (cycle_id, owner_user_id)
  WHERE status IN ('creating', 'active');

CREATE TABLE ride_requests (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  ride_offer_id TEXT NOT NULL REFERENCES ride_offers(id) ON DELETE CASCADE,
  rider_user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('morning', 'return')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  queue_position INTEGER NOT NULL,
  accepted_order INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX active_request_by_direction
  ON ride_requests (cycle_id, rider_user_id, direction)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX ride_requests_by_offer
  ON ride_requests (ride_offer_id, direction, status, queue_position);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  cycle_id TEXT REFERENCES cycles(id) ON DELETE CASCADE,
  ride_offer_id TEXT REFERENCES ride_offers(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
