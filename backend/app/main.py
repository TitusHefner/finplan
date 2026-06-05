from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import expenses, forecasts, incomes, fixed_expenses, advanced, mobile, plaid, accounts, chat, balance

app = FastAPI(title="Smart Budget App", version="2.0.0", description="State-of-the-art personal finance management platform")

@app.on_event("startup")
def _create_tables():
    from app.database import engine
    from app.models import Base
    Base.metadata.create_all(bind=engine)
    _run_column_migrations(engine)


def _run_column_migrations(engine):
    """Add any missing columns to existing tables (SQLite ALTER TABLE)."""
    migrations = [
        ("transactions", "recurring_frequency", "TEXT"),
        ("transactions", "recurring_day",       "INTEGER"),
        ("transactions", "recurring_start_date","DATETIME"),
        ("transactions", "is_pending",          "BOOLEAN DEFAULT 0"),
        ("plaid_balance_snapshots", "id",        None),  # table existence check only
    ]
    with engine.connect() as conn:
        for table, col, col_type in migrations:
            if col_type is None:
                continue
            rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            existing_cols = [r[1] for r in rows]
            if col not in existing_cols:
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
        conn.commit()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],  # React dev server
    # Allow Tailscale IPs (100.x.x.x) and MagicDNS hostnames (*.ts.net) on any port
    allow_origin_regex=r"https?://(100\.\d+\.\d+\.\d+|[\w-]+\.ts\.net)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Legacy routes (keeping for backward compatibility)
app.include_router(expenses.router, prefix="/api/expenses", tags=["expenses"])
app.include_router(forecasts.router, prefix="/api/forecasts", tags=["forecasts"])
app.include_router(incomes.router, prefix="/api/incomes", tags=["incomes"])
app.include_router(fixed_expenses.router, prefix="/api/fixed-expenses", tags=["fixed-expenses"])

# Advanced routes for state-of-the-art features
app.include_router(advanced.router, prefix="/api", tags=["advanced"])
app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])

# Mobile-optimised routes consumed by the iOS SwiftUI app.
app.include_router(mobile.router, prefix="/api/mobile", tags=["mobile"])

# Plaid bank-linking routes
app.include_router(plaid.router, prefix="/api/plaid", tags=["plaid"])

# AI Financial Advisor chat
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])

# Balance tracking & projection
app.include_router(balance.router, prefix="/api/balance", tags=["balance"])

@app.get("/")
def read_root():
    return {
        "message": "Welcome to Smart Budget App v2.0",
        "version": "2.0.0",
        "features": [
            "Multi-account management",
            "Advanced categorization",
            "Budget planning & tracking",
            "Goal setting & monitoring",
            "Transaction management",
            "Financial analytics",
            "Forecasting & insights"
        ]
    }