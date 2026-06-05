import sqlite3
import os
import shutil
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Store the database in AppData\Local\SmartBudget\ — a location SQLite can always write to on Windows.
_DB_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "SmartBudget")
os.makedirs(_DB_DIR, exist_ok=True)
_DB_FILE = os.path.join(_DB_DIR, "budget.db")

def _backup_database():
    """Copy the database to a timestamped backup, keeping only the 7 most recent backups."""
    if not os.path.isfile(_DB_FILE):
        return
    backup_dir = os.path.join(_DB_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_dir, f"budget_{timestamp}.db")
    try:
        shutil.copy2(_DB_FILE, backup_path)
        # Prune: keep only the 7 most recent backups
        backups = sorted(
            [f for f in os.listdir(backup_dir) if f.startswith("budget_") and f.endswith(".db")],
            reverse=True,
        )
        for old in backups[7:]:
            os.remove(os.path.join(backup_dir, old))
    except Exception as e:
        print(f"[WARNING] Database backup failed: {e}")

_backup_database()

# Use proper file-based URL so SQLAlchemy pools connections correctly.
_DB_URL = "sqlite:///" + _DB_FILE.replace("\\", "/")

def _creator():
    return sqlite3.connect(_DB_FILE, check_same_thread=False, timeout=10)

engine = create_engine(_DB_URL, connect_args={"check_same_thread": False, "timeout": 10})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def _run_migrations():
    """Apply incremental schema additions to the existing SQLite DB at startup."""
    import sqlite3 as _sl
    conn = _sl.connect(_DB_FILE, check_same_thread=False)
    for ddl in [
        "ALTER TABLE categories ADD COLUMN is_savings BOOLEAN DEFAULT 0",
        "ALTER TABLE transactions ADD COLUMN recurring_end_date DATETIME",
        """CREATE TABLE IF NOT EXISTS planned_incomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            planned_date DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS planned_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            planned_date DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)",
        """CREATE TABLE IF NOT EXISTS budget_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_id INTEGER NOT NULL REFERENCES budgets(id),
            amount REAL NOT NULL,
            effective_from DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
    ]:
        try:
            conn.execute(ddl)
            conn.commit()
        except _sl.OperationalError:
            pass  # column/table already exists

    # Backfill: for every budget that has no history row yet, insert the initial
    # amount with effective_from = 1900-01-01 so it covers all historical months.
    conn.execute("""
        INSERT INTO budget_history (budget_id, amount, effective_from)
        SELECT id, amount, '1900-01-01 00:00:00'
        FROM budgets
        WHERE id NOT IN (SELECT DISTINCT budget_id FROM budget_history)
    """)
    conn.commit()

    # Remove content-duplicate Plaid transactions: same description + amount + date,
    # different plaid_transaction_id. Keep the row with the lowest id in each group.
    conn.execute("""
        DELETE FROM transactions
        WHERE plaid_transaction_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id)
            FROM transactions
            WHERE plaid_transaction_id IS NOT NULL
            GROUP BY description,
                     amount,
                     substr(transaction_date, 1, 10)
          )
    """)
    conn.commit()
    conn.close()


_run_migrations()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()