import json
import os
import sqlite3
import sys
from pathlib import Path


def emit(value):
    print(json.dumps(value, separators=(",", ":")))


def sqlite_connection(config):
    database_path = Path(config.get("path") or "data/bot.sqlite")
    if not database_path.is_absolute():
        database_path = Path.cwd() / database_path
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS wallets (
            user_id TEXT PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
        )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            counterparty_id TEXT,
            amount INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS daily_claims (
            user_id TEXT PRIMARY KEY,
            claim_date TEXT NOT NULL,
            claim_count INTEGER NOT NULL DEFAULT 0 CHECK (claim_count >= 0)
        )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS user_experience (
            user_id TEXT PRIMARY KEY,
            experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0)
        )"""
    )
    connection.commit()
    return connection


def mongo_database(config):
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError

    uri_env = config.get("uriEnv") or "MONGODB_URI"
    uri = os.environ.get(uri_env, "").strip() or str(config.get("uri") or "").strip()
    if not uri:
        raise RuntimeError(
            f"MongoDB selected but database.uri or environment secret {uri_env} is missing."
        )
    client = MongoClient(uri, serverSelectionTimeoutMS=8000)
    client.admin.command("ping")
    database = client[config.get("name") or "telegram_bot"]
    database.wallets.create_index("_id", unique=True)
    database.wallet_transactions.create_index("created_at")
    database.daily_claims.create_index("_id", unique=True)
    database.user_experience.create_index("_id", unique=True)
    return client, database, PyMongoError


def ensure_sqlite_wallet(connection, user_id):
    connection.execute(
        "INSERT OR IGNORE INTO wallets(user_id, balance) VALUES(?, 0)",
        (user_id,),
    )


def run_sqlite(config, request):
    connection = sqlite_connection(config)
    try:
        action = request["action"]
        if action == "init":
            return {"ok": True, "type": "sqlite"}

        if action == "balance":
            user_id = str(request["userId"])
            ensure_sqlite_wallet(connection, user_id)
            connection.commit()
            row = connection.execute(
                "SELECT balance FROM wallets WHERE user_id = ?", (user_id,)
            ).fetchone()
            return {"balance": row["balance"]}

        if action == "daily_reward":
            user_id = str(request["userId"])
            claim_date = str(request["claimDate"])
            max_claims = int(request["maxClaims"])
            coins = int(request["coins"])
            experience = int(request["experience"])
            if not user_id or not claim_date or max_claims <= 0 or coins <= 0 or experience < 0:
                raise ValueError("Invalid daily reward request.")

            connection.execute("BEGIN IMMEDIATE")
            ensure_sqlite_wallet(connection, user_id)
            claim = connection.execute(
                "SELECT claim_date, claim_count FROM daily_claims WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            previous_count = (
                int(claim["claim_count"])
                if claim and claim["claim_date"] == claim_date
                else 0
            )
            if previous_count >= max_claims:
                connection.rollback()
                balance = connection.execute(
                    "SELECT balance FROM wallets WHERE user_id = ?",
                    (user_id,),
                ).fetchone()["balance"]
                return {
                    "ok": False,
                    "reason": "limit",
                    "count": previous_count,
                    "balance": balance,
                }

            claim_count = previous_count + 1
            connection.execute(
                """INSERT INTO daily_claims(user_id, claim_date, claim_count)
                   VALUES(?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET
                       claim_date = excluded.claim_date,
                       claim_count = excluded.claim_count""",
                (user_id, claim_date, claim_count),
            )
            connection.execute(
                "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
                (coins, user_id),
            )
            connection.execute(
                """INSERT INTO wallet_transactions(user_id, counterparty_id, amount, reason)
                   VALUES(?, NULL, ?, ?)""",
                (user_id, coins, "daily-reward"),
            )
            connection.execute(
                """INSERT INTO user_experience(user_id, experience)
                   VALUES(?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET
                       experience = user_experience.experience + excluded.experience""",
                (user_id, experience),
            )
            balance = connection.execute(
                "SELECT balance FROM wallets WHERE user_id = ?",
                (user_id,),
            ).fetchone()["balance"]
            total_experience = connection.execute(
                "SELECT experience FROM user_experience WHERE user_id = ?",
                (user_id,),
            ).fetchone()["experience"]
            connection.commit()
            return {
                "ok": True,
                "count": claim_count,
                "balance": balance,
                "experience": total_experience,
                "coins": coins,
                "expReward": experience,
            }

        if action in ("credit", "debit", "transfer"):
            amount = int(request["amount"])
            if amount <= 0:
                raise ValueError("Amount must be a positive integer.")
            user_id = str(request["userId"])
            counterparty_id = str(request["counterpartyId"]) if request.get("counterpartyId") else None
            reason = str(request.get("reason") or action)
            connection.execute("BEGIN IMMEDIATE")
            ensure_sqlite_wallet(connection, user_id)
            if counterparty_id:
                ensure_sqlite_wallet(connection, counterparty_id)

            if action == "credit":
                connection.execute(
                    "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
                    (amount, user_id),
                )
                connection.execute(
                    "INSERT INTO wallet_transactions(user_id, counterparty_id, amount, reason) VALUES(?, NULL, ?, ?)",
                    (user_id, amount, reason),
                )
            else:
                row = connection.execute(
                    "SELECT balance FROM wallets WHERE user_id = ?", (user_id,)
                ).fetchone()
                if row["balance"] < amount:
                    connection.rollback()
                    return {"ok": False, "reason": "insufficient", "balance": row["balance"]}
                connection.execute(
                    "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
                    (amount, user_id),
                )
                connection.execute(
                    "INSERT INTO wallet_transactions(user_id, counterparty_id, amount, reason) VALUES(?, ?, ?, ?)",
                    (user_id, counterparty_id, -amount, reason),
                )
                if counterparty_id and counterparty_id != user_id:
                    connection.execute(
                        "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
                        (amount, counterparty_id),
                    )
                    connection.execute(
                        "INSERT INTO wallet_transactions(user_id, counterparty_id, amount, reason) VALUES(?, ?, ?, ?)",
                        (counterparty_id, user_id, amount, reason),
                    )

            connection.commit()
            balance = connection.execute(
                "SELECT balance FROM wallets WHERE user_id = ?", (user_id,)
            ).fetchone()["balance"]
            return {"ok": True, "balance": balance}

        raise ValueError(f"Unsupported database action: {action}")
    finally:
        connection.close()


def run_mongo(config, request):
    client, database, _ = mongo_database(config)
    try:
        action = request["action"]
        if action == "init":
            return {"ok": True, "type": "mongodb"}

        if action == "balance":
            user_id = str(request["userId"])
            wallet = database.wallets.find_one_and_update(
                {"_id": user_id},
                {"$setOnInsert": {"balance": 0}},
                upsert=True,
                return_document=True,
            )
            return {"balance": int(wallet.get("balance", 0))}

        if action == "daily_reward":
            user_id = str(request["userId"])
            claim_date = str(request["claimDate"])
            max_claims = int(request["maxClaims"])
            coins = int(request["coins"])
            experience = int(request["experience"])
            if not user_id or not claim_date or max_claims <= 0 or coins <= 0 or experience < 0:
                raise ValueError("Invalid daily reward request.")

            def claim_reward(session):
                database.wallets.update_one(
                    {"_id": user_id},
                    {"$setOnInsert": {"balance": 0}},
                    upsert=True,
                    session=session,
                )
                claim = database.daily_claims.find_one({"_id": user_id}, session=session)
                previous_count = (
                    int(claim.get("count", 0))
                    if claim and claim.get("claim_date") == claim_date
                    else 0
                )
                if previous_count >= max_claims:
                    wallet = database.wallets.find_one({"_id": user_id}, session=session)
                    return {
                        "ok": False,
                        "reason": "limit",
                        "count": previous_count,
                        "balance": int(wallet.get("balance", 0)),
                    }

                claim_count = previous_count + 1
                database.daily_claims.update_one(
                    {"_id": user_id},
                    {"$set": {"claim_date": claim_date, "count": claim_count}},
                    upsert=True,
                    session=session,
                )
                database.wallets.update_one(
                    {"_id": user_id},
                    {"$inc": {"balance": coins}},
                    session=session,
                )
                database.user_experience.update_one(
                    {"_id": user_id},
                    {"$inc": {"experience": experience}},
                    upsert=True,
                    session=session,
                )
                database.wallet_transactions.insert_one(
                    {"user_id": user_id, "amount": coins, "reason": "daily-reward"},
                    session=session,
                )
                wallet = database.wallets.find_one({"_id": user_id}, session=session)
                total_experience = database.user_experience.find_one(
                    {"_id": user_id},
                    session=session,
                )
                return {
                    "ok": True,
                    "count": claim_count,
                    "balance": int(wallet.get("balance", 0)),
                    "experience": int(total_experience.get("experience", 0)),
                    "coins": coins,
                    "expReward": experience,
                }

            with client.start_session() as session:
                return session.with_transaction(claim_reward)

        if action in ("credit", "debit", "transfer"):
            from pymongo import ReturnDocument

            amount = int(request["amount"])
            if amount <= 0:
                raise ValueError("Amount must be a positive integer.")
            user_id = str(request["userId"])
            counterparty_id = str(request["counterpartyId"]) if request.get("counterpartyId") else None
            reason = str(request.get("reason") or action)

            def transaction(session):
                database.wallets.update_one(
                    {"_id": user_id},
                    {"$setOnInsert": {"balance": 0}},
                    upsert=True,
                    session=session,
                )
                if counterparty_id:
                    database.wallets.update_one(
                        {"_id": counterparty_id},
                        {"$setOnInsert": {"balance": 0}},
                        upsert=True,
                        session=session,
                    )

                if action == "credit":
                    database.wallets.update_one(
                        {"_id": user_id},
                        {"$inc": {"balance": amount}},
                        session=session,
                    )
                    database.wallet_transactions.insert_one(
                        {"user_id": user_id, "amount": amount, "reason": reason},
                        session=session,
                    )
                else:
                    updated = database.wallets.find_one_and_update(
                        {"_id": user_id, "balance": {"$gte": amount}},
                        {"$inc": {"balance": -amount}},
                        return_document=ReturnDocument.AFTER,
                        session=session,
                    )
                    if updated is None:
                        return {"ok": False, "reason": "insufficient"}

                    database.wallet_transactions.insert_one(
                        {
                            "user_id": user_id,
                            "counterparty_id": counterparty_id,
                            "amount": -amount,
                            "reason": reason,
                        },
                        session=session,
                    )
                    if counterparty_id and counterparty_id != user_id:
                        database.wallets.update_one(
                            {"_id": counterparty_id},
                            {"$inc": {"balance": amount}},
                            session=session,
                        )
                        database.wallet_transactions.insert_one(
                            {
                                "user_id": counterparty_id,
                                "counterparty_id": user_id,
                                "amount": amount,
                                "reason": reason,
                            },
                            session=session,
                        )
                    return {"ok": True, "balance": int(updated["balance"])}

                wallet = database.wallets.find_one({"_id": user_id}, session=session)
                return {"ok": True, "balance": int(wallet["balance"])}

            with client.start_session() as session:
                result = session.with_transaction(transaction)
            return result

        raise ValueError(f"Unsupported database action: {action}")
    finally:
        client.close()


def main():
    try:
        request = json.load(sys.stdin)
        config = request.get("config") or {}
        database_type = str(config.get("type") or "sqlite").lower()
        if database_type == "sqlite":
            result = run_sqlite(config, request)
        elif database_type in ("mongodb", "mongo"):
            result = run_mongo(config, request)
        else:
            raise ValueError("database.type must be sqlite or mongodb.")
        emit({"success": True, "result": result})
    except Exception as error:
        message = str(error)
        if "://" in message:
            message = "Database operation failed; check the database settings and connection."
        emit({"success": False, "error": message})
        sys.exit(1)


if __name__ == "__main__":
    main()
