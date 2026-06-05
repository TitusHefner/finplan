"""
Adds new columns to existing tables without dropping data.
Safe to run multiple times - skips columns that already exist.
"""
import sqlite3
import os

# Match the path used by app/database.py
_DB_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "SmartBudget")
db_path = os.path.join(_DB_DIR, "budget.db")
print("DB path:", db_path)
conn = sqlite3.connect(db_path)
cur = conn.cursor()

def column_exists(table, col):
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()]
    return col in cols

migrations = [
    ("transactions", "recurring_frequency", "TEXT"),
    ("transactions", "recurring_day",       "INTEGER"),
    ("transactions", "recurring_start_date","DATETIME"),
    ("transactions", "is_pending",          "BOOLEAN DEFAULT 0"),
    ("balance_snapshots", "id",             None),  # just a check — table created by create_all
]

# Ensure balance_snapshots table exists (create_all handles this on startup,
# but run it here too for safety)
from app.database import engine
from app.models import Base
Base.metadata.create_all(bind=engine)
print("create_all done")

for table, col, col_type in migrations:
    if col_type is None:
        continue
    if not column_exists(table, col):
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
        print(f"Added {table}.{col}")
    else:
        print(f"Already exists: {table}.{col}")

conn.commit()
conn.close()
print("Migration complete.")
