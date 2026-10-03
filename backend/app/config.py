import os

OFFICE = {
    "name": "Jane Street London",
    "short_name": "Devonshire Square",
    "address": "2½ Devonshire Square, London EC2M 4UJ",
    "lat": 51.516562,  # postcodes.io, EC2M 4UJ
    "lon": -0.079831,
}

# met: Compendium of Physical Activities, used for calorie estimates.
# credits_per_mile: points research in docs/SUMMARY.md (walk 50/mi, cycle 25/mi).
MODES = {
    "walk": {"label": "Walk", "osrm_profile": "foot", "credits_per_mile": 50, "met": 3.5},
    "cycle": {"label": "Cycle", "osrm_profile": "bike", "credits_per_mile": 25, "met": 6.8},
}
# Flat credits per trip for modes that still beat driving alone (product decision, docs/QUESTIONS.md).
FLAT_TRIPS = {
    "bus": {"label": "Bus", "credits": 15},
    "carshare": {"label": "Car share", "credits": 10},
}

# Credits economy (product decisions, docs/QUESTIONS.md).
WEEKLY_ALLOWANCE = 1000
CAR_PARK_PENALTY = 250
TREE_PLANTED = 150
TEAM_WIN_BONUS = 50
DAILY_CAP = 300
MIN_LEG_MI = 0.5
TOKENS_PER_CREDIT = 1000
PENCE_PER_CREDIT = 1
MIN_CASHOUT_CREDITS = 500
# Seeded into the settings table; the DB value is what the app uses.
DEFAULT_FLOOR_PRICE_DECIPENCE = 10  # 1.0p a credit, the cash-out value, so nobody sells below it
DEFAULT_HOUSE_PRICE_DECIPENCE = 40  # 4.0p a credit, Jane Street's own price

# Ledger kinds. Earned credits are the only ones that can be sold; team score is net of parking.
EARN_KINDS = ("walk", "cycle", "bus", "carshare", "tree", "team_bonus")
SCORE_KINDS = ("walk", "cycle", "bus", "carshare", "tree", "car_park")
TIMEZONE = "Europe/London"

KM_PER_MILE = 1.609344
CAR_KG_CO2E_PER_KM = 0.16725  # DESNZ GHG conversion factors 2025, average car, unknown fuel
CONGESTION_CHARGE_GBP = 18.00  # TfL, from 2 Jan 2026
PARKING_GBP_PER_HOUR = 5.80  # City of London, London Wall car park
PARKING_HOURS = 9
FUEL_GBP_PER_MILE = 0.16  # HMRC advisory fuel rates from 1 Sep 2026, petrol 14-17p/mile

# Assumptions, not sourced figures.
CAR_PEAK_FACTOR = 1.6  # OSRM car durations assume empty roads
PARKING_SEARCH_MIN = 8
BODY_KG = 70
WORKING_DAYS_PER_YEAR = 220

STOP_RADIUS_M = 200
STOPS_PER_CATEGORY = {"coffee": 8, "breakfast": 6, "scenic": 8}
WALK_M_PER_MIN = 80

# Commute tracking checks, starting points from docs/TRACKING.md (untested thresholds).
TRACK_UPLOAD_EVERY_S = 15
TRACK_MAX_ACCURACY_M = 50
TRACK_MAX_POINT_AGE_S = 180
TRACK_MAX_GAP_S = 180
TRACK_MIN_COVERAGE = 0.8
TRACK_CORRIDOR_M = 100
TRACK_MIN_IN_CORRIDOR = 0.8
TRACK_FINISH_RADIUS_M = 150
TRACK_MIN_DURATION_FACTOR = 0.6  # can't beat 0.6x the OSRM duration
TRACK_SPEED_KMH = {"walk": (3, 8, 12), "cycle": (8, 28, 40)}  # min avg, max avg, max 60 s window
TRACK_STALE_AFTER_H = 3
LIVE_HIDE_AFTER_S = 900  # teammates stop seeing a live position this long after its last fix
NEAR_HOME_M = 2000  # teammates living this close are suggested as commute partners

# Demo replay (app/demo.py): on unless DEMO_REPLAY=0, and how long the frontend animates it.
DEMO_REPLAY = os.environ.get("DEMO_REPLAY", "1") != "0"
DEMO_REPLAY_S = 10
TOTP_STEP_S = 30
