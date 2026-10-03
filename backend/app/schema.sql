PRAGMA foreign_keys = ON;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  colour TEXT NOT NULL
);

CREATE TABLE areas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  car_distance_km REAL NOT NULL,
  car_duration_min REAL NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  area_id INTEGER NOT NULL REFERENCES areas(id),
  usual_mode TEXT NOT NULL
);
CREATE INDEX users_team ON users(team_id);

-- Cached likely routes from each area to the office (OSRM).
CREATE TABLE routes (
  id INTEGER PRIMARY KEY,
  area_id INTEGER NOT NULL REFERENCES areas(id),
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  distance_km REAL NOT NULL,
  duration_min REAL NOT NULL,
  coords TEXT NOT NULL,          -- JSON [[lat, lon], ...]
  rank INTEGER NOT NULL          -- 0 = the area's usual route for this mode
);
CREATE INDEX routes_area ON routes(area_id);

-- OpenStreetMap places imported once from Overpass.
CREATE TABLE places (
  id TEXT PRIMARY KEY,           -- node/123, way/456
  name TEXT NOT NULL,
  category TEXT NOT NULL,        -- coffee, breakfast, scenic
  subtype TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  brand INTEGER NOT NULL,
  opening_hours TEXT,
  website TEXT
);

CREATE TABLE route_stops (
  route_id INTEGER NOT NULL REFERENCES routes(id),
  place_id TEXT NOT NULL REFERENCES places(id),
  off_route_m INTEGER NOT NULL,
  along_km REAL NOT NULL,
  detour_min INTEGER NOT NULL,
  PRIMARY KEY (route_id, place_id)
);

CREATE TABLE trips (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL,            -- walk, cycle, bus, carshare
  route_id INTEGER REFERENCES routes(id),
  status TEXT NOT NULL,          -- active, verified, review, rejected, abandoned
  started_at TEXT NOT NULL,
  finished_at TEXT,
  distance_km REAL,
  car_distance_km REAL,
  credits INTEGER NOT NULL DEFAULT 0,
  reasons TEXT                   -- JSON list
);
CREATE INDEX trips_user ON trips(user_id, started_at);

CREATE TABLE trip_points (
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  seq INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  t_client TEXT NOT NULL,
  received_at TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  accuracy_m REAL NOT NULL,
  PRIMARY KEY (trip_id, seq, idx)
);

CREATE TABLE trees (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  place TEXT NOT NULL,
  lat REAL,
  lon REAL,
  photo BLOB,
  photo_type TEXT,
  status TEXT NOT NULL,          -- in_review, approved, rejected
  created_at TEXT NOT NULL
);

-- Every credit movement. Balance = SUM(credits).
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  credits INTEGER NOT NULL,
  ref TEXT,                      -- idempotency key, e.g. week start for allowance
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, kind, ref)
);
CREATE INDEX ledger_user ON ledger(user_id, created_at);
CREATE INDEX ledger_time ON ledger(created_at);

CREATE TABLE team_awards (
  week_start TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  credits INTEGER NOT NULL,
  PRIMARY KEY (week_start, team_id)
);

-- Prices are in tenths of a penny.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  qty_initial INTEGER NOT NULL,
  qty_remaining INTEGER NOT NULL,
  global_price_dp INTEGER NOT NULL,
  teammate_price_dp INTEGER NOT NULL,
  status TEXT NOT NULL,          -- open, filled, cancelled
  created_at TEXT NOT NULL
);
CREATE INDEX listings_open ON listings(status, global_price_dp);

CREATE TABLE trades (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER REFERENCES users(id),   -- NULL when bought from Jane Street
  qty INTEGER NOT NULL,
  price_dp INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX trades_time ON trades(created_at);

-- Car-free offers (app/switch.py): a driver asks for a bonus to walk or cycle in on `day` instead.
CREATE TABLE switch_offers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,             -- the commute day, YYYY-MM-DD in London
  ask INTEGER NOT NULL,          -- credits asked for
  status TEXT NOT NULL,          -- open, funded, waitlisted, paid, expired
  trip_id INTEGER REFERENCES trips(id),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (user_id, day)
);
CREATE INDEX switch_day ON switch_offers(day, status, ask);
