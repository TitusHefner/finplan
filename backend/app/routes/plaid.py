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

    env_map = {
        "sandbox":     plaid.Environment.Sandbox,
        "development": plaid.Environment.Sandbox,
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
                # Timestamp is utcnow() so only transactions entered AFTER this moment
                # are layered on top — transactions already reflected in the Plaid balance
                # have transaction_date <= now and are not double-counted.
                if tracker_account_id and plaid_acct_id == tracker_account_id and current is not None:
                    balance_snap = models.BalanceSnapshot(
                        amount=current,
                        snapshot_date=datetime.utcnow(),
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
    Returns a reconstructed daily balance history by:
    1. Using the sum of the most-recent Plaid account snapshots as today's anchor.
    2. Walking backward using all Plaid-imported transactions to infer prior-day balances.
    3. Optionally anchoring at any stored intermediate snapshots to correct drift.

    Plaid does not expose a historical balance API, so this is the best reconstruction
    available from /accounts/get (free) plus transaction data.
    """
    from collections import defaultdict
    from sqlalchemy import func

    # Sum current balance across the most-recent snapshot for each account
    subq = (
        db.query(
            models.PlaidBalanceSnapshot.plaid_account_id,
            func.max(models.PlaidBalanceSnapshot.captured_at).label("latest"),
        )
        .group_by(models.PlaidBalanceSnapshot.plaid_account_id)
        .subquery()
    )
    latest_snaps = (
        db.query(models.PlaidBalanceSnapshot)
        .join(
            subq,
            (models.PlaidBalanceSnapshot.plaid_account_id == subq.c.plaid_account_id)
            & (models.PlaidBalanceSnapshot.captured_at == subq.c.latest),
        )
        .all()
    )
    if not latest_snaps:
        return []

    anchor_total = sum(s.current or 0.0 for s in latest_snaps)

    # Find oldest snapshot to determine lookback range
    oldest = (
        db.query(models.PlaidBalanceSnapshot)
        .order_by(models.PlaidBalanceSnapshot.captured_at.asc())
        .first()
    )
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    earliest = oldest.captured_at.replace(hour=0, minute=0, second=0, microsecond=0)

    # Collect all Plaid-imported transactions in range for walk-back
    plaid_txns = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.plaid_transaction_id.isnot(None),
            models.Transaction.transaction_date >= earliest,
            models.Transaction.transaction_type.in_([
                models.TransactionType.INCOME,
                models.TransactionType.EXPENSE,
            ]),
        )
        .all()
    )

    daily_net: dict[str, float] = defaultdict(float)
    for tx in plaid_txns:
        d = tx.transaction_date.strftime("%Y-%m-%d")
        if tx.transaction_type == models.TransactionType.INCOME:
            daily_net[d] += abs(tx.amount)
        else:
            daily_net[d] -= abs(tx.amount)

    # Build per-day aggregate snapshots so we can re-anchor on days with real data
    # {date_str: total_current} — sum across all accounts for that day
    daily_snap_totals: dict[str, dict[str, float]] = defaultdict(dict)
    all_snaps = db.query(models.PlaidBalanceSnapshot).all()
    for s in all_snaps:
        dk = s.captured_at.strftime("%Y-%m-%d")
        acct = s.plaid_account_id
        daily_snap_totals[dk][acct] = s.current or 0.0
    # Sum per day (use the most recent snapshot per account per day)
    daily_snap_sum: dict[str, float] = {
        dk: sum(accts.values()) for dk, accts in daily_snap_totals.items()
    }

    # Walk backward from today's anchor
    result = []
    bal = anchor_total
    d = today
    while d >= earliest:
        date_key = d.strftime("%Y-%m-%d")
        # If we stored a real snapshot on this day, re-anchor to correct drift
        if date_key in daily_snap_sum and date_key != today.strftime("%Y-%m-%d"):
            bal = daily_snap_sum[date_key]
        result.append({"date": date_key, "balance": round(bal, 2)})
        # Reverse-apply this day's net to get the balance at end of previous day
        bal -= daily_net.get(date_key, 0.0)
        d -= timedelta(days=1)

    result.reverse()
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
    if existing:
        item = existing
        item.access_token = access_token
    else:
        item = models.PlaidItem(
            item_id=item_id,
            access_token=access_token,
            institution_name=payload.institution_name,
            account_id=payload.account_id,
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
