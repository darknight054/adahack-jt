"""The credit exchange. Prices are stored in tenths of a penny (dp) and returned in pence."""
import sqlite3
from datetime import datetime, timedelta

from . import config, economy
from .db import setting, write
from .economy import iso
from .errors import Rejected

HOUSE = "house"


def pence(dp: int) -> float:
    return dp / 10


def prices(conn: sqlite3.Connection) -> tuple[int, int]:
    return int(setting(conn, "floor_price_dp")), int(setting(conn, "house_price_dp"))


def _team(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("SELECT team_id FROM users WHERE id = ?", (user_id,)).fetchone()[0]


def person(conn: sqlite3.Connection, user_id: int) -> dict:
    u = conn.execute(
        "SELECT u.id, u.name, t.name AS team, t.colour FROM users u JOIN teams t ON t.id = u.team_id WHERE u.id = ?",
        (user_id,),
    ).fetchone()
    return {"id": u["id"], "name": u["name"], "initials": "".join(p[0] for p in u["name"].split()),
            "team": u["team"], "colour": u["colour"]}


def _open_for(conn: sqlite3.Connection, buyer_id: int) -> list[dict]:
    team = _team(conn, buyer_id)
    rows = conn.execute(
        """SELECT l.*, u.team_id FROM listings l JOIN users u ON u.id = l.seller_id
           WHERE l.status = 'open' AND l.seller_id != ?""",
        (buyer_id,),
    ).fetchall()
    out = []
    for r in rows:
        mate = r["team_id"] == team
        out.append({**dict(r), "teammate": mate, "price_dp": r["teammate_price_dp"] if mate else r["global_price_dp"]})
    return sorted(out, key=lambda r: (r["price_dp"], r["created_at"]))


def _same_offer(rows: list[dict], lead: dict) -> list[dict]:
    """A seller's open listings at the same price for this buyer, oldest first. The book shows them as one row."""
    return [r for r in rows if r["seller_id"] == lead["seller_id"] and r["price_dp"] == lead["price_dp"]]


def listings(conn: sqlite3.Connection, buyer_id: int) -> list[dict]:
    """The order book as this buyer sees it, plus their own open listings (at the global price) marked `mine`.
    A seller's listings at the same price are one row, identified by the oldest listing."""
    open_rows = _open_for(conn, buyer_id)
    rows, seen = [], set()
    for r in open_rows:
        if (r["seller_id"], r["price_dp"]) not in seen:
            seen.add((r["seller_id"], r["price_dp"]))
            rows.append({**r, "qty_remaining": sum(x["qty_remaining"] for x in _same_offer(open_rows, r))})
    own = conn.execute("SELECT * FROM listings WHERE seller_id = ? AND status = 'open'", (buyer_id,)).fetchall()
    rows += [{**dict(r), "teammate": False, "mine": True, "price_dp": r["global_price_dp"]} for r in own]
    rows.sort(key=lambda r: (r["price_dp"], r["created_at"]))
    return [
        {"id": r["id"], "seller": person(conn, r["seller_id"]), "teammate": r["teammate"], "mine": r.get("mine", False),
         "qty": r["qty_remaining"], "price_pence": pence(r["price_dp"]),
         "teammate_price_pence": pence(r["teammate_price_dp"]), "created_at": r["created_at"]}
        for r in rows
    ]


def my_listings(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM listings WHERE seller_id = ? AND status = 'open' ORDER BY created_at DESC", (user_id,)
    ).fetchall()
    return [{"id": r["id"], "qty": r["qty_remaining"], "global_price_pence": pence(r["global_price_dp"]),
             "teammate_price_pence": pence(r["teammate_price_dp"]), "created_at": r["created_at"]} for r in rows]


def summary(conn: sqlite3.Connection, user_id: int, at: datetime) -> dict:
    floor, house = prices(conn)
    since = iso(at - timedelta(days=7))
    history = conn.execute(
        "SELECT created_at AS at, price_dp FROM trades WHERE seller_id IS NOT NULL AND created_at >= ? "
        "ORDER BY created_at", (since,)
    ).fetchall()
    last = conn.execute(
        "SELECT price_dp FROM trades WHERE seller_id IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    first = history[0]["price_dp"] if history else None
    volume = conn.execute(
        "SELECT COALESCE(SUM(qty), 0) FROM trades WHERE created_at >= ?", (iso(economy.week_start(at)),)
    ).fetchone()[0]
    asks = _open_for(conn, user_id)
    return {
        "last_price_pence": pence(last[0]) if last else None,
        "change_week_pct": round((last[0] - first) / first * 100, 1) if last and first else None,
        "best_ask_pence": pence(asks[0]["price_dp"]) if asks else None,
        "volume_week": volume,
        "floor_price_pence": pence(floor),
        "house_price_pence": pence(house),
        "history": [{"at": h["at"], "price_pence": pence(h["price_dp"])} for h in history],
    }


def create_listing(conn: sqlite3.Connection, user_id: int, qty: int, global_dp: int, teammate_dp: int,
                   at: datetime) -> dict:
    floor, house = prices(conn)
    if qty < 1:
        raise Rejected(422, "List at least 1 credit.")
    if teammate_dp < floor:
        raise Rejected(422, f"Prices can't go below the floor of {pence(floor)}p.")
    if teammate_dp > global_dp:
        raise Rejected(422, "The teammate price can't be above the global price.")
    if global_dp >= house:
        raise Rejected(422, f"Prices must be below Jane Street's {pence(house)}p.")
    with write(conn):
        available = economy.sellable(conn, user_id)
        if qty > available:
            raise Rejected(422, f"You have {available} earned credits free to list.")
        cur = conn.execute(
            "INSERT INTO listings (seller_id, qty_initial, qty_remaining, global_price_dp, teammate_price_dp, status, "
            "created_at) VALUES (?,?,?,?,?, 'open', ?)",
            (user_id, qty, qty, global_dp, teammate_dp, iso(at)),
        )
    return next(x for x in my_listings(conn, user_id) if x["id"] == cur.lastrowid)


def cancel_listing(conn: sqlite3.Connection, user_id: int, listing_id: int) -> None:
    with write(conn):
        cur = conn.execute(
            "UPDATE listings SET status = 'cancelled' WHERE id = ? AND seller_id = ? AND status = 'open'",
            (listing_id, user_id),
        )
    if cur.rowcount == 0:
        raise Rejected(404, "That listing isn't open any more.")


def _trade_view(conn: sqlite3.Connection, t: sqlite3.Row, user_id: int) -> dict:
    side = "buy" if t["buyer_id"] == user_id else "sell"
    other = t["seller_id"] if side == "buy" else t["buyer_id"]
    return {"id": t["id"], "side": side, "qty": t["qty"], "price_pence": pence(t["price_dp"]),
            "counterparty": person(conn, other) if other else None, "at": t["created_at"]}


def buy(conn: sqlite3.Connection, user_id: int, listing_id: int | str, qty: int, price_dp: int, at: datetime) -> dict:
    if qty < 1:
        raise Rejected(422, "Buy at least 1 credit.")
    with write(conn):
        if listing_id == HOUSE:
            _, house = prices(conn)
            if price_dp != house:
                raise Rejected(409, "Jane Street's price changed before your order reached it.")
            seller_id = None
        else:
            if conn.execute("SELECT 1 FROM listings WHERE id = ? AND seller_id = ?", (listing_id, user_id)).fetchone():
                raise Rejected(422, "That's your own listing. Cancel it under My listings instead.")
            open_rows = _open_for(conn, user_id)
            row = next((r for r in open_rows if r["id"] == listing_id), None)
            group = _same_offer(open_rows, row) if row else []
            if row is None or sum(r["qty_remaining"] for r in group) < qty or row["price_dp"] != price_dp:
                raise Rejected(409, "That listing changed before your order reached it.")
            seller_id = row["seller_id"]
            if economy.balance(conn, seller_id) < qty:
                conn.execute("UPDATE listings SET status = 'cancelled' WHERE id = ?", (listing_id,))
                raise Rejected(409, "The seller no longer has those credits.")
            need = qty
            for r in group:  # fill the seller's listings at this price, oldest first
                take = min(need, r["qty_remaining"])
                left = r["qty_remaining"] - take
                conn.execute("UPDATE listings SET qty_remaining = ?, status = ? WHERE id = ?",
                             (left, "open" if left else "filled", r["id"]))
                need -= take
                if not need:
                    break
        cur = conn.execute(
            "INSERT INTO trades (listing_id, buyer_id, seller_id, qty, price_dp, created_at) VALUES (?,?,?,?,?,?)",
            (None if seller_id is None else listing_id, user_id, seller_id, qty, price_dp, iso(at)),
        )
        ref = f"trade:{cur.lastrowid}"
        seller = person(conn, seller_id)["name"] if seller_id else "Jane Street"
        economy.add(conn, user_id, "buy", qty, f"Bought {qty} credits from {seller} at {pence(price_dp)}p", at, ref)
        if seller_id:
            buyer = person(conn, user_id)["name"]
            economy.add(conn, seller_id, "sell", -qty, f"Sold {qty} credits to {buyer} at {pence(price_dp)}p", at, ref)
        trade = conn.execute("SELECT * FROM trades WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _trade_view(conn, trade, user_id)


def my_trades(conn: sqlite3.Connection, user_id: int, limit: int = 30) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM trades WHERE buyer_id = ? OR seller_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, user_id, limit),
    ).fetchall()
    return [_trade_view(conn, t, user_id) for t in rows]


def convert(conn: sqlite3.Connection, user_id: int, to: str, credits: int, at: datetime) -> dict:
    if credits < 1:
        raise Rejected(422, "Convert at least 1 credit.")
    if to == "gbp" and credits < config.MIN_CASHOUT_CREDITS:
        raise Rejected(422, f"Cash-outs start at {config.MIN_CASHOUT_CREDITS} credits.")
    with write(conn):
        free = economy.balance(conn, user_id) - economy.listed(conn, user_id)
        if credits > free:
            raise Rejected(422, f"You have {max(free, 0)} credits that aren't listed for sale.")
        if to == "gbp":
            out = {"to": to, "credits": credits, "gbp_pence": credits * config.PENCE_PER_CREDIT}
            detail = f"Cashed out {credits} credits"
        else:
            out = {"to": to, "credits": credits, "tokens": credits * config.TOKENS_PER_CREDIT}
            detail = f"Converted {credits} credits to {out['tokens']:,} coding tokens"
        economy.add(conn, user_id, f"convert_{'gbp' if to == 'gbp' else 'tokens'}", -credits, detail, at)
    return out
