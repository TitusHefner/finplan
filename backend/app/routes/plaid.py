"""
Plaid bank-linking routes.

Environment variables required (add to a .env file in backend/):
  PLAID_CLIENT_ID   – from console.plaid.com
  PLAID_SECRET      – Sandbox secret from console.plaid.com
  PLAID_ENV         – "sandbox" | "development" | "production"  (default: sandbox)

Plaid Link flow:
  1. POST /api/plaid/link-token        → get link_token for the frontend
  2. Frontend opens Plaid Link           user authenticates with bank
  3. POST /api/plaid/exchange           exchange public_token → access_token, kick off sync
  4. POST /api/plaid/sync/{item_id}     (optional) pull latest transactions

All Plaid transactions are auto-categorised by ai_service after import.
Duplicate transactions (same plaid_transaction_id) are silently skipped.
"""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timedelta
from typing import Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import database, models
from app.services.ai_service import categorize_transaction

load_dotenv()

router = APIRouter()

# ── In-memory sync job tracker ─────────────────────────────────────────────
# { job_id: {"status": "running"|"done"|"error", "result": {...}, "error": str} }
_sync_jobs: dict = {}


def _run_sync_in_background(job_id: str, item_id: str):
    """Thread target: runs _sync_transactions and updates _sync_jobs."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        item = db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()
        if not item:
            _sync_jobs[job_id] = {"status": "error", "error": "Plaid item not found"}
            return
        client = _get_plaid_client()
        result = _sync_transactions(item, db, client)
        _sync_jobs[job_id] = {"status": "done", "result": result.dict()}
    except Exception as exc:
        _sync_jobs[job_id] = {"status": "error", "error": str(exc)}
    finally:
        db.close()

_TRACKER_ACCOUNT_KEY = "plaid_tracker_account_id"


class TrackerAccountRequest(BaseModel):
    plaid_account_id: str  # Plaid's account_id string for the chosen account


@router.get("/tracker-account")
def get_tracker_account(db: Session = Depends(database.get_db)):
    """Return the Plaid account currently used as the balance tracker source."""
    setting = db.query(models.AppSettings).filter(
        models.AppSettings.key == _TRACKER_ACCOUNT_KEY
    ).first()
    return {"plaid_account_id": setting.value if setting else None}


@router.post("/tracker-account")
def set_tracker_account(
    payload: TrackerAccountRequest,
    db: Session = Depends(database.get_db),
):
    """Set which Plaid account drives the balance tracker."""
    setting = db.query(models.AppSettings).filter(
        models.AppSettings.key == _TRACKER_ACCOUNT_KEY
    ).first()
    if setting:
        setting.value = payload.plaid_account_id
    else:
        db.add(models.AppSettings(key=_TRACKER_ACCOUNT_KEY, value=payload.plaid_account_id))
    db.commit()
    return {"plaid_account_id": payload.plaid_account_id}


@router.delete("/tracker-account")
def clear_tracker_account(db: Session = Depends(database.get_db)):
    """Remove the Plaid account link so the tracker uses manual snapshots again."""
    db.query(models.AppSettings).filter(
        models.AppSettings.key == _TRACKER_ACCOUNT_KEY
    ).delete()
    db.commit()
    return {"plaid_account_id": None}


# ── Plaid client factory ───────────────────────────────────────────────────


def _get_plaid_client():
    """Build a Plaid ApiClient.  Raises clearly if env vars are missing."""
    try:
        import plaid
        from plaid.api import plaid_api
        from plaid.model.products import Products
        from plaid.model.country_code import CountryCode
        from plaid.configuration import Configuration
        from plaid.api_client import ApiClient
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="plaid-python is not installed. Run: pip install plaid-python",
        )

    client_id = os.getenv("PLAID_CLIENT_ID")
    secret = os.getenv("PLAID_SECRET")
    env_name = os.getenv("PLAID_ENV", "sandbox").lower()

    if not client_id or not secret:
        raise HTTPException(
            status_code=500,
            detail=(
                "PLAID_CLIENT_ID and PLAID_SECRET must be set in your .env file. "
                "Get free sandbox credentials at https://dashboard.plaid.com/signup"
            ),
        )

    dev_env = getattr(plaid.Environment, "Development", plaid.Environment.Sandbox)
    env_map = {
        "sandbox":     plaid.Environment.Sandbox,
        "development": dev_env,
        "production":  plaid.Environment.Production,
    }
    configuration = Configuration(
        host=env_map.get(env_name, plaid.Environment.Sandbox),
        api_key={"clientId": client_id, "secret": secret},
    )
    return plaid_api.PlaidApi(ApiClient(configuration))


# ── Request / Response models ──────────────────────────────────────────────


class ExchangeRequest(BaseModel):
    public_token: str
    institution_name: Optional[str] = None
    account_id: Optional[int] = None  # our internal Account to attach transactions to


class SyncResult(BaseModel):
    added: int
    modified: int
    removed: int
    categorized: int
    note: str = ""


# ── Endpoints ──────────────────────────────────────────────────────────────


@router.get("/balances")
def get_plaid_balances(db: Session = Depends(database.get_db)):
    """
    Fetch cached account balances for all linked Items using /accounts/get.
    This is free and uses Plaid's most recently cached balance data.
    Also saves a daily snapshot per account to build up balance history.
    If a tracker account is configured, auto-creates a BalanceSnapshot so the
    balance tracker's "Current Balance" stays in sync with the live bank balance.
    """
    from plaid.model.accounts_get_request import AccountsGetRequest

    client = _get_plaid_client()
    items = db.query(models.PlaidItem).all()
    if not items:
        return []

    # Check if a tracker account is configured
    tracker_setting = db.query(models.AppSettings).filter(
        models.AppSettings.key == _TRACKER_ACCOUNT_KEY
    ).first()
    tracker_account_id = tracker_setting.value if tracker_setting else None

    results = []
    for item in items:
        try:
            response = client.accounts_get(
                AccountsGetRequest(access_token=item.access_token)
            )
            for acct in response["accounts"]:
                balances = acct.get("balances", {})
                current = balances.get("current")
                available = balances.get("available")
                currency = balances.get("iso_currency_code") or balances.get("unofficial_currency_code")
                plaid_acct_id = acct.get("account_id")

                # Save one snapshot per account per day (skip if already captured today)
                existing_today = (
                    db.query(models.PlaidBalanceSnapshot)
                    .filter(
                        models.PlaidBalanceSnapshot.plaid_account_id == plaid_acct_id,
                        models.PlaidBalanceSnapshot.captured_at >= datetime.utcnow().replace(
                            hour=0, minute=0, second=0, microsecond=0
                        ),
                    )
                    .first()
                )
                if not existing_today:
                    snap = models.PlaidBalanceSnapshot(
                        item_id=item.item_id,
                        plaid_account_id=plaid_acct_id,
                        account_name=acct.get("official_name") or acct.get("name"),
                        institution_name=item.institution_name,
                        current=current,
                        available=available,
                        currency=currency,
                    )
                    db.add(snap)

                # If this is the configured tracker account, write a fresh BalanceSnapshot
                # so the balance tracker reflects the live bank balance.
                # Use the current timestamp (not start-of-day) so this live anchor is always
                # the most recent snapshot and won't be superseded by an older manual value.
                if tracker_account_id and plaid_acct_id == tracker_account_id and current is not None:
                    snapshot_timestamp = datetime.utcnow()
                    balance_snap = models.BalanceSnapshot(
                        amount=current,
                        snapshot_date=snapshot_timestamp,
                    )
                    db.add(balance_snap)

                results.append({
                    "institution_name": item.institution_name,
                    "item_id": item.item_id,
                    "account_id": plaid_acct_id,
                    "name": acct.get("name"),
                    "official_name": acct.get("official_name"),
                    "type": str(acct.get("type", "")),
                    "subtype": str(acct.get("subtype", "")),
                    "current": current,
                    "available": available,
                    "limit": balances.get("limit"),
                    "currency": currency,
                    "last_updated_datetime": str(balances.get("last_updated_datetime") or ""),
                    "is_tracker_source": plaid_acct_id == tracker_account_id,
                })
        except Exception as exc:
            results.append({
                "institution_name": item.institution_name,
                "item_id": item.item_id,
                "error": str(exc),
                "is_tracker_source": False,
            })

    db.commit()
    return results


@router.get("/balance-history")
def get_plaid_balance_history(db: Session = Depends(database.get_db)):
    """
    Return a daily Plaid balance series derived from captured /accounts/get snapshots.

    If a tracker account is configured, the history is scoped to that single Plaid
    account so the chart aligns with the selected balance source.

    We forward-fill between capture days to produce a continuous line without
    transaction-based drift.
    """
    tracker_setting = db.query(models.AppSettings).filter(
        models.AppSettings.key == _TRACKER_ACCOUNT_KEY
    ).first()
    tracker_account_id = tracker_setting.value if tracker_setting else None

    snaps_q = db.query(models.PlaidBalanceSnapshot)
    if tracker_account_id:
        snaps_q = snaps_q.filter(models.PlaidBalanceSnapshot.plaid_account_id == tracker_account_id)

    snaps = snaps_q.order_by(models.PlaidBalanceSnapshot.captured_at.asc()).all()
    if not snaps:
        return []

    # Keep the latest snapshot per account per day.
    by_day_account: dict[str, dict[str, tuple[datetime, float]]] = {}
    for s in snaps:
        day_key = s.captured_at.strftime("%Y-%m-%d")
        acct_key = s.plaid_account_id or ""
        if day_key not in by_day_account:
            by_day_account[day_key] = {}
        prev = by_day_account[day_key].get(acct_key)
        if prev is None or s.captured_at > prev[0]:
            by_day_account[day_key][acct_key] = (s.captured_at, float(s.current or 0.0))

    # Collapse each day to a total (single account if tracker selected; otherwise sum accounts).
    day_totals: dict[str, float] = {
        day: sum(v[1] for v in acct_map.values())
        for day, acct_map in by_day_account.items()
    }

    start_day = snaps[0].captured_at.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Forward-fill to produce a continuous daily line.
    result = []
    running = None
    d = start_day
    while d <= end_day:
        key = d.strftime("%Y-%m-%d")
        if key in day_totals:
            running = day_totals[key]
        if running is not None:
            result.append({"date": key, "balance": round(running, 2)})
        d += timedelta(days=1)

    return result


@router.post("/link-token/update/{item_id}")
def create_update_link_token(item_id: str, db: Session = Depends(database.get_db)):
    """
    Create a link_token in update mode for an existing item that has
    ITEM_LOGIN_REQUIRED. The frontend re-opens Plaid Link with this token
    to let the user re-authenticate without creating a new item.
    """
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.country_code import CountryCode

    item = db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Plaid item not found")

    client = _get_plaid_client()
    redirect_uri = os.getenv("PLAID_REDIRECT_URI")

    request_kwargs = dict(
        client_name="SmartBudget",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id="default-user"),
        access_token=item.access_token,
    )
    if redirect_uri:
        request_kwargs["redirect_uri"] = redirect_uri

    try:
        response = client.link_token_create(LinkTokenCreateRequest(**request_kwargs))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Plaid error: {exc}")
    return {"link_token": response["link_token"]}


@router.post("/link-token")
def create_link_token():
    """
    Step 1: Create a short-lived Plaid link_token.
    The React frontend passes this to `usePlaidLink` to open the bank chooser.
    """
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.products import Products
    from plaid.model.country_code import CountryCode

    client = _get_plaid_client()

    redirect_uri = os.getenv("PLAID_REDIRECT_URI")

    request_kwargs = dict(
        products=[Products("transactions")],
        optional_products=[Products("liabilities")],
        client_name="SmartBudget",
        country_codes=[CountryCode("US")],
        language="en",
        # In production, use a real unique user identifier here.
        user=LinkTokenCreateRequestUser(client_user_id="default-user"),
    )
    if redirect_uri:
        request_kwargs["redirect_uri"] = redirect_uri

    request = LinkTokenCreateRequest(**request_kwargs)
    try:
        response = client.link_token_create(request)
    except Exception as exc:
        exc_str = str(exc)
        if "Data Transparency Messaging" in exc_str or "use case" in exc_str.lower():
            raise HTTPException(
                status_code=400,
                detail=(
                    "Plaid requires Data Transparency Messaging to be configured. "
                    "Go to dashboard.plaid.com → Team Settings → Link → Customization → Default → "
                    "enable 'Data Transparency Messaging' and select at least one use case (e.g. Personal finances)."
                ),
            )
        raise HTTPException(status_code=502, detail=f"Plaid error: {exc_str}")
    return {"link_token": response["link_token"]}


@router.post("/exchange", response_model=SyncResult)
def exchange_public_token(
    payload: ExchangeRequest,
    db: Session = Depends(database.get_db),
):
    """
    Step 2: Exchange the public_token returned by Plaid Link for a
    persistent access_token, store it, and perform the initial transaction sync.
    """
    from plaid.model.item_public_token_exchange_request import (
        ItemPublicTokenExchangeRequest,
    )

    client = _get_plaid_client()

    exchange_response = client.item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=payload.public_token)
    )
    access_token = exchange_response["access_token"]
    item_id = exchange_response["item_id"]

    # Upsert the PlaidItem record
    existing = (
        db.query(models.PlaidItem)
        .filter(models.PlaidItem.item_id == item_id)
        .first()
    )

    # Auto-detect whether all accounts in this Item are liability (credit/loan) type.
    # We call accounts/get immediately after exchange so we can tag the item correctly.
    _LIABILITY_ACCOUNT_TYPES = {"credit", "loan"}
    is_liability = False
    try:
        from plaid.model.accounts_get_request import AccountsGetRequest as _AGR
        _accts_resp = client.accounts_get(_AGR(access_token=access_token))
        _acct_types = {str(a.get("type", "")).lower() for a in _accts_resp["accounts"]}
        # Mark as liability only if EVERY account is credit or loan (not mixed with depository)
        if _acct_types and _acct_types.issubset(_LIABILITY_ACCOUNT_TYPES):
            is_liability = True
    except Exception:
        pass  # If detection fails, default to False (safe — shows in balance tracker)

    if existing:
        item = existing
        item.access_token = access_token
        item.is_liability = is_liability
    else:
        item = models.PlaidItem(
            item_id=item_id,
            access_token=access_token,
            institution_name=payload.institution_name,
            account_id=payload.account_id,
            is_liability=is_liability,
        )
        db.add(item)
        db.commit()
        db.refresh(item)

    try:
        return _sync_transactions(item, db, client)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Plaid sync error: {exc}")


@router.post("/recategorize", response_model=dict)
def recategorize_all(db: Session = Depends(database.get_db)):
    """Re-run AI categorization on all transactions that have no ai_category_id."""
    txs = (
        db.query(models.Transaction)
        .filter(models.Transaction.ai_category_id == None)
        .all()
    )
    updated = 0
    for tx in txs:
        cat_id, confidence, _ = categorize_transaction(tx.description or "", db, None)
        if cat_id:
            tx.ai_category_id = cat_id
            tx.category_id = tx.category_id or cat_id
            tx.ai_confidence = confidence
            tx.ai_categorized = True
            updated += 1
        else:
            tx.ai_categorized = True  # mark as processed even if no match
    db.commit()
    return {"processed": len(txs), "categorized": updated}


@router.post("/sync/{item_id}")
def sync_transactions(item_id: str, db: Session = Depends(database.get_db)):
    """
    Kick off a background sync for an existing linked account.
    Returns immediately with a job_id; poll GET /sync/status/{job_id} for results.
    """
    item = (
        db.query(models.PlaidItem)
        .filter(models.PlaidItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Plaid item not found")

    job_id = str(uuid.uuid4())
    _sync_jobs[job_id] = {"status": "running"}
    t = threading.Thread(target=_run_sync_in_background, args=(job_id, item_id), daemon=True)
    t.start()
    return {"job_id": job_id, "status": "running"}


@router.get("/sync/status/{job_id}")
def sync_status(job_id: str):
    """Poll for the result of a background sync job."""
    job = _sync_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/items")
def list_items(db: Session = Depends(database.get_db)):
    """List all linked bank connections."""
    items = db.query(models.PlaidItem).all()
    return [
        {
            "id": i.id,
            "item_id": i.item_id,
            "institution_name": i.institution_name,
            "last_synced_at": i.last_synced_at,
        }
        for i in items
    ]


@router.post("/items/{item_id}/reset-cursor")
def reset_item_cursor(item_id: str, db: Session = Depends(database.get_db)):
    """
    Clear the stored sync cursor for an item so the next sync does a full
    re-fetch from Plaid. Used after re-authentication to recover missed transactions.
    The content-based dedup guard in _sync_transactions prevents re-importing
    transactions that are already in the database.
    """
    item = (
        db.query(models.PlaidItem)
        .filter(models.PlaidItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Plaid item not found")
    item.cursor = None
    db.commit()
    return {"item_id": item_id, "cursor": None}


@router.delete("/items/{item_id}")
def remove_item(
    item_id: str,
    delete_transactions: bool = False,
    db: Session = Depends(database.get_db),
):
    """Unlink a bank connection. Pass ?delete_transactions=true to also purge imported transactions."""
    item = (
        db.query(models.PlaidItem)
        .filter(models.PlaidItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Plaid item not found")

    deleted_count = 0
    if delete_transactions:
        # Delete all transactions that were imported from Plaid (have a plaid_transaction_id)
        # scoped to this item's account to avoid touching manually-entered transactions.
        query = db.query(models.Transaction).filter(
            models.Transaction.plaid_transaction_id.isnot(None)
        )
        if item.account_id is not None:
            query = query.filter(models.Transaction.account_id == item.account_id)
        deleted_count = query.delete(synchronize_session=False)

    db.delete(item)
    db.commit()
    return {"message": "Item removed", "transactions_deleted": deleted_count}


# ── Internal sync helper ───────────────────────────────────────────────────


def _sync_transactions(
    item: models.PlaidItem, db: Session, client
) -> SyncResult:
    """
    Pull transactions from Plaid using the cursor-based /transactions/sync API,
    upsert them into the local DB, and auto-categorise new ones.

    Handles TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION by restarting pagination
    from the cursor we had at the start of this call (up to 3 retries).
    """
    import time
    from plaid.model.transactions_sync_request import TransactionsSyncRequest

    # cursor at the start of this sync call; may be reset to None on mutation error
    start_cursor = item.cursor or None

    for attempt in range(3):
        added_count = modified_count = removed_count = categorized_count = 0
        has_more = True
        cursor = start_cursor

        try:
            while has_more:
                request = TransactionsSyncRequest(
                    access_token=item.access_token,
                    **({"cursor": cursor} if cursor else {}),
                )
                response = client.transactions_sync(request)

                # ── Pre-scan removed list to preserve user-set flags ───
                # When a pending transaction posts, Plaid puts the pending ID in
                # "removed" and the permanent ID in "added". We save any user flags
                # (is_recurring, confirmed category) keyed by (amount, date) so we
                # can restore them onto the newly-added posted transaction.
                _pending_flags: dict = {}
                for _pt in response.get("removed", []):
                    _tx = (
                        db.query(models.Transaction)
                        .filter(models.Transaction.plaid_transaction_id == _pt["transaction_id"])
                        .first()
                    )
                    if _tx and (_tx.is_recurring or _tx.user_confirmed_category):
                        _d = _tx.transaction_date.strftime("%Y-%m-%d") if _tx.transaction_date else ""
                        _key = (round(_tx.amount, 2), _d)
                        _pending_flags[_key] = {
                            "is_recurring": _tx.is_recurring,
                            "recurring_frequency": _tx.recurring_frequency,
                            "recurring_day": _tx.recurring_day,
                            "recurring_start_date": _tx.recurring_start_date,
                            "recurring_end_date": _tx.recurring_end_date,
                            "category_id": _tx.category_id,
                            "user_confirmed_category": _tx.user_confirmed_category,
                        }

                # ── Added ──────────────────────────────────────────────
                for pt in response["added"]:
                    existing = (
                        db.query(models.Transaction)
                        .filter(
                            models.Transaction.plaid_transaction_id == pt["transaction_id"]
                        )
                        .first()
                    )
                    if existing:
                        continue

                    amount = -float(pt["amount"])
                    tx_type = (
                        models.TransactionType.INCOME
                        if amount > 0
                        else models.TransactionType.EXPENSE
                    )

                    plaid_cats = pt.get("category") or []
                    plaid_hint = " > ".join(plaid_cats) if plaid_cats else None
                    cat_id, confidence, _ = categorize_transaction(pt["name"], db, plaid_hint)

                    tx_date = pt["date"]
                    if isinstance(tx_date, str):
                        tx_date = datetime.strptime(tx_date, "%Y-%m-%d")
                    elif hasattr(tx_date, 'year'):
                        tx_date = datetime(tx_date.year, tx_date.month, tx_date.day)

                    # Content-based dedup guard: same description + amount + date
                    # prevents re-importing the same transaction after a cursor reset
                    content_dup = (
                        db.query(models.Transaction)
                        .filter(
                            models.Transaction.description == pt["name"],
                            models.Transaction.amount == amount,
                            models.Transaction.transaction_date == tx_date,
                            models.Transaction.plaid_transaction_id.isnot(None),
                        )
                        .first()
                    )
                    if content_dup:
                        # Update its plaid_transaction_id to the new one so future
                        # plaid_transaction_id checks match correctly
                        content_dup.plaid_transaction_id = pt["transaction_id"]
                        continue

                    tx = models.Transaction(
                        account_id=item.account_id,
                        amount=amount,
                        description=pt["name"],
                        transaction_type=tx_type,
                        transaction_date=tx_date,
                        plaid_transaction_id=pt["transaction_id"],
                        category_id=cat_id,
                        ai_category_id=cat_id,
                        ai_confidence=confidence,
                        ai_categorized=True,
                        user_confirmed_category=False,
                    )

                    # Restore user flags if this posted tx replaces a pending one
                    _flag_key = (round(amount, 2), tx_date.strftime("%Y-%m-%d"))
                    if _flag_key in _pending_flags:
                        _flags = _pending_flags.pop(_flag_key)
                        tx.is_recurring = _flags["is_recurring"]
                        tx.recurring_frequency = _flags["recurring_frequency"]
                        tx.recurring_day = _flags["recurring_day"]
                        tx.recurring_start_date = _flags["recurring_start_date"]
                        tx.recurring_end_date = _flags["recurring_end_date"]
                        if _flags["category_id"]:
                            tx.category_id = _flags["category_id"]
                        if _flags["user_confirmed_category"]:
                            tx.user_confirmed_category = True

                    db.add(tx)
                    added_count += 1
                    if cat_id:
                        categorized_count += 1

                # ── Modified ───────────────────────────────────────────
                for pt in response["modified"]:
                    tx = (
                        db.query(models.Transaction)
                        .filter(
                            models.Transaction.plaid_transaction_id == pt["transaction_id"]
                        )
                        .first()
                    )
                    if tx:
                        tx.amount = -float(pt["amount"])
                        tx.description = pt["name"]
                        tx_date = pt["date"]
                        if isinstance(tx_date, str):
                            tx_date = datetime.strptime(tx_date, "%Y-%m-%d")
                        elif hasattr(tx_date, 'year'):
                            tx_date = datetime(tx_date.year, tx_date.month, tx_date.day)
                        tx.transaction_date = tx_date
                        modified_count += 1

                # ── Removed ────────────────────────────────────────────
                for pt in response["removed"]:
                    tx = (
                        db.query(models.Transaction)
                        .filter(
                            models.Transaction.plaid_transaction_id == pt["transaction_id"]
                        )
                        .first()
                    )
                    if tx:
                        db.delete(tx)
                        removed_count += 1

                # ── Advance cursor ─────────────────────────────────────
                cursor = response["next_cursor"]
                item.cursor = cursor
                has_more = response["has_more"]

                # Commit each page so progress is saved
                item.last_synced_at = datetime.utcnow()
                db.commit()

            # All pages done successfully
            return SyncResult(
                added=added_count,
                modified=modified_count,
                removed=removed_count,
                categorized=categorized_count,
            )

        except Exception as exc:
            if "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" not in str(exc):
                raise

            # Plaid data changed mid-pagination.
            # 1. Rollback the current uncommitted page.
            # 2. Re-query item (rollback detaches/expires ORM objects — re-querying
            #    gives us a fresh session-attached instance, avoiding "prepared state" errors).
            # 3. Reset cursor to None so next attempt does a full resync from page 1
            #    (safe because plaid_transaction_id dedup skips already-saved rows).
            # 4. Sleep a few seconds for Plaid's data to settle, then retry.
            db.rollback()

            item = db.query(models.PlaidItem).filter(
                models.PlaidItem.item_id == item.item_id
            ).first()
            item.cursor = None
            db.commit()

            start_cursor = None

            if attempt < 2:
                time.sleep(3)  # let Plaid data settle before retrying
                continue

            # All 3 attempts exhausted — return what we have; user can sync again
            return SyncResult(
                added=added_count,
                modified=modified_count,
                removed=removed_count,
                categorized=categorized_count,
                note="Plaid data changed during sync. Click Sync again to fetch remaining transactions.",
            )


# -- Liabilities ------------------------------------------------------------

@router.get("/liabilities")
def get_liabilities(db: Session = Depends(database.get_db)):
    """
    Fetch detailed liability info for all linked Items using /liabilities/get.
    Requires the 'liabilities' product to have been requested at link time.
    Returns enriched credit card and student loan data including APR,
    minimum payment, due date, last payment, and past-due amounts.
    """
    from plaid.model.liabilities_get_request import LiabilitiesGetRequest

    client = _get_plaid_client()
    items = db.query(models.PlaidItem).all()
    if not items:
        return {"credit": [], "student": [], "mortgage": []}

    all_credit = []
    all_student = []
    all_mortgage = []

    for item in items:
        try:
            response = client.liabilities_get(
                LiabilitiesGetRequest(access_token=item.access_token)
            )
            liabilities = response.get("liabilities", {})
            accounts_by_id = {a["account_id"]: a for a in response.get("accounts", [])}

            # ── Credit cards ──────────────────────────────────────────────
            for cc in (liabilities.get("credit") or []):
                acct = accounts_by_id.get(cc.get("account_id"), {})
                balances = acct.get("balances", {})
                aprs = []
                for apr in (cc.get("aprs") or []):
                    aprs.append({
                        "type": str(apr.get("apr_type", "")),
                        "rate": apr.get("apr_percentage"),
                    })
                all_credit.append({
                    "account_id": cc.get("account_id"),
                    "name": acct.get("name"),
                    "official_name": acct.get("official_name"),
                    "institution_name": item.institution_name,
                    "subtype": str(acct.get("subtype", "")),
                    "current_balance": balances.get("current"),
                    "credit_limit": balances.get("limit"),
                    "available": balances.get("available"),
                    "currency": balances.get("iso_currency_code") or "USD",
                    "last_payment_amount": cc.get("last_payment_amount"),
                    "last_payment_date": str(cc.get("last_payment_date") or ""),
                    "last_statement_balance": cc.get("last_statement_balance"),
                    "last_statement_issue_date": str(cc.get("last_statement_issue_date") or ""),
                    "minimum_payment_amount": cc.get("minimum_payment_amount"),
                    "next_payment_due_date": str(cc.get("next_payment_due_date") or ""),
                    "is_overdue": cc.get("is_overdue", False),
                    "aprs": aprs,
                    "purchase_apr": next((a["rate"] for a in aprs if "purchase" in a["type"].lower()), None),
                })

            # ── Student loans ─────────────────────────────────────────────
            for sl in (liabilities.get("student") or []):
                acct = accounts_by_id.get(sl.get("account_id"), {})
                balances = acct.get("balances", {})
                all_student.append({
                    "account_id": sl.get("account_id"),
                    "name": acct.get("name"),
                    "institution_name": item.institution_name,
                    "servicer_address": sl.get("servicer_address"),
                    "current_balance": balances.get("current"),
                    "currency": balances.get("iso_currency_code") or "USD",
                    "interest_rate_percentage": sl.get("interest_rate_percentage"),
                    "minimum_payment_amount": sl.get("minimum_payment_amount"),
                    "next_payment_due_date": str(sl.get("next_payment_due_date") or ""),
                    "origination_principal_amount": sl.get("origination_principal_amount"),
                    "outstanding_interest_amount": sl.get("outstanding_interest_amount"),
                    "last_payment_amount": sl.get("last_payment_amount"),
                    "last_payment_date": str(sl.get("last_payment_date") or ""),
                    "is_overdue": sl.get("is_overdue", False),
                    "repayment_plan": str(sl.get("repayment_plan", {}).get("type", "") if sl.get("repayment_plan") else ""),
                    "expected_payoff_date": str(sl.get("expected_payoff_date") or ""),
                })

            # ── Mortgages ─────────────────────────────────────────────────
            for mg in (liabilities.get("mortgage") or []):
                acct = accounts_by_id.get(mg.get("account_id"), {})
                balances = acct.get("balances", {})
                all_mortgage.append({
                    "account_id": mg.get("account_id"),
                    "name": acct.get("name"),
                    "institution_name": item.institution_name,
                    "current_balance": balances.get("current"),
                    "currency": balances.get("iso_currency_code") or "USD",
                    "interest_rate": mg.get("interest_rate", {}).get("percentage") if mg.get("interest_rate") else None,
                    "last_payment_amount": mg.get("last_payment_amount"),
                    "last_payment_date": str(mg.get("last_payment_date") or ""),
                    "minimum_monthly_payment": mg.get("minimum_monthly_payment"),
                    "next_monthly_payment": mg.get("next_monthly_payment"),
                    "next_payment_due_date": str(mg.get("next_payment_due_date") or ""),
                    "origination_principal_amount": mg.get("origination_principal_amount"),
                    "maturity_date": str(mg.get("maturity_date") or ""),
                    "is_overdue": mg.get("is_overdue", False),
                    "property_address": mg.get("property_address"),
                })

        except Exception as exc:
            # liabilities product not enabled for this item — skip gracefully
            err_str = str(exc)
            if "PRODUCTS_NOT_SUPPORTED" in err_str or "INVALID_PRODUCT" in err_str or "liabilities" in err_str.lower():
                continue
            raise HTTPException(status_code=502, detail=f"Plaid liabilities error: {err_str}")

    return {"credit": all_credit, "student": all_student, "mortgage": all_mortgage}


# -- Debt Accounts ----------------------------------------------------------

@router.get("/debt-accounts")
def get_debt_accounts(db: Session = Depends(database.get_db)):
    """
    Return only credit card and loan accounts from Plaid.
    Used by the Financial Planning page to surface debt for goal creation.
    Each account includes: name, type, subtype, current balance (amount owed),
    credit limit (for cards), utilization %, and institution name.
    """
    from plaid.model.accounts_get_request import AccountsGetRequest

    DEBT_TYPES = {"credit", "loan"}
    DEBT_SUBTYPES = {
        "credit card", "paypal", "line of credit",
        "auto", "business", "commercial", "construction",
        "consumer", "home equity", "loan", "mortgage",
        "overdraft", "student", "other",
    }

    client = _get_plaid_client()
    items = db.query(models.PlaidItem).all()
    if not items:
        return []

    results = []
    for item in items:
        try:
            response = client.accounts_get(
                AccountsGetRequest(access_token=item.access_token)
            )
            for acct in response["accounts"]:
                acct_type = str(acct.get("type", "")).lower()
                acct_subtype = str(acct.get("subtype", "")).lower()
                if acct_type not in DEBT_TYPES and acct_subtype not in DEBT_SUBTYPES:
                    continue

                balances = acct.get("balances", {})
                current = balances.get("current") or 0.0
                limit = balances.get("limit")
                utilization = None
                if limit and limit > 0:
                    utilization = round((current / limit) * 100, 1)

                results.append({
                    "account_id": acct.get("account_id"),
                    "name": acct.get("name"),
                    "official_name": acct.get("official_name"),
                    "type": acct_type,
                    "subtype": acct_subtype,
                    "institution_name": item.institution_name,
                    "current_balance": current,
                    "credit_limit": limit,
                    "utilization_pct": utilization,
                    "currency": balances.get("iso_currency_code") or "USD",
                })
        except Exception as exc:
            results.append({
                "institution_name": item.institution_name,
                "error": str(exc),
            })

    return results
