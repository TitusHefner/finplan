from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import List, Optional
import calendar
from app import database, models

router = APIRouter()

def _liability_account_ids(db: Session) -> list[int]:
    """
    Return the internal account_id values used by liability PlaidItems
    (credit cards, loans).  Transactions tagged with these account_ids
    should be excluded from the checking-account balance tracker.
    Only non-NULL account_ids are returned.
    """
    rows = (
        db.query(models.PlaidItem.account_id)
        .filter(
            models.PlaidItem.is_liability == True,
            models.PlaidItem.account_id.isnot(None),
        )
        .all()
    )
    return [r.account_id for r in rows]


class PlannedExpenseCreate(BaseModel):
    description: str
    amount: float
    planned_date: datetime


class PlannedExpenseResponse(BaseModel):
    id: int
    description: str
    amount: float
    planned_date: datetime

    class Config:
        from_attributes = True


class PlannedIncomeCreate(BaseModel):
    description: str
    amount: float
    planned_date: datetime


class PlannedIncomeResponse(BaseModel):
    id: int
    description: str
    amount: float
    planned_date: datetime

    class Config:
        from_attributes = True


class SnapshotCreate(BaseModel):
    amount: float
    snapshot_date: datetime = None


class SnapshotResponse(BaseModel):
    id: int
    amount: float
    snapshot_date: datetime

    class Config:
        from_attributes = True


class CurrentBalanceResponse(BaseModel):
    current_balance: float
    snapshot_amount: float
    snapshot_date: datetime
    total_income_since: float
    total_expenses_since: float


class ProjectionPoint(BaseModel):
    date: str
    balance: float


class BreakdownItem(BaseModel):
    label: str
    amount: float  # positive = income, negative = expense


class BreakdownDay(BaseModel):
    date: str
    items: List[BreakdownItem]

class CategoryEstimate(BaseModel):
    category_id: Optional[int]
    category_name: str
    monthly_estimate: float
    estimation_method: str  # "prior_month" | "avg_months" | "budget"
    months_of_data: Optional[int] = None


# Variable spending category names to include in projection estimates.
# These match typical category names users would have.
VARIABLE_CATEGORIES = {
    "food & dining", "food and dining", "dining", "restaurants",
    "transportation", "entertainment", "healthcare", "medical",
    "shopping", "personal care", "travel",
    "other expense", "other", "gas", "gasoline", "groceries",
}


def _is_variable_category(name: str) -> bool:
    return name.lower() in VARIABLE_CATEGORIES


def _month_start_end(year: int, month: int):
    """Return (start, end) datetime for the given calendar month."""
    last_day = calendar.monthrange(year, month)[1]
    return datetime(year, month, 1), datetime(year, month, last_day, 23, 59, 59)


def _months_back(n: int) -> list[tuple[int, int]]:
    """Return the last n (year, month) pairs going backwards from the previous month."""
    today = datetime.now()
    result = []
    year, month = today.year, today.month
    for _ in range(n):
        month -= 1
        if month == 0:
            month = 12
            year -= 1
        result.append((year, month))
    return result


def _category_spending_for_month(db: Session, category_id: int, year: int, month: int) -> float:
    start, end = _month_start_end(year, month)
    total = (
        db.query(func.sum(func.abs(models.Transaction.amount)))
        .filter(
            models.Transaction.category_id == category_id,
            models.Transaction.transaction_type == models.TransactionType.EXPENSE,
            models.Transaction.is_recurring == False,
            models.Transaction.transaction_date >= start,
            models.Transaction.transaction_date <= end,
        )
        .scalar()
    )
    return float(total or 0.0)


def _category_spending_for_range(db: Session, category_id: int, start: datetime, end: datetime) -> float:
    """Sum of non-recurring expense transactions for a category between start (inclusive) and end (exclusive)."""
    total = (
        db.query(func.sum(func.abs(models.Transaction.amount)))
        .filter(
            models.Transaction.category_id == category_id,
            models.Transaction.transaction_type == models.TransactionType.EXPENSE,
            models.Transaction.is_recurring == False,
            models.Transaction.transaction_date >= start,
            models.Transaction.transaction_date < end,
        )
        .scalar()
    )
    return float(total or 0.0)


def _budget_for_category(db: Session, category_id: int) -> Optional[float]:
    today = datetime.now()
    budget = (
        db.query(models.Budget)
        .filter(
            models.Budget.category_id == category_id,
            models.Budget.is_active == True,
            models.Budget.period_start <= today,
            models.Budget.period_end >= today,
        )
        .first()
    )
    if budget:
        return budget.amount
    # Fall back to any active budget for this category
    budget = (
        db.query(models.Budget)
        .filter(models.Budget.category_id == category_id, models.Budget.is_active == True)
        .order_by(models.Budget.created_at.desc())
        .first()
    )
    return budget.amount if budget else None


def _compute_variable_estimates(
    db: Session,
    estimation_method: str,
    avg_months: int,
) -> list[CategoryEstimate]:
    """
    For each variable-spending category that has transactions, compute a
    monthly spend estimate using the chosen method.
    """
    # Get all non-savings, non-income categories
    categories = (
        db.query(models.Category)
        .filter(
            models.Category.is_active == True,
            models.Category.is_income == False,
            models.Category.is_savings == False,
        )
        .all()
    )

    estimates: list[CategoryEstimate] = []

    for cat in categories:
        if not _is_variable_category(cat.name):
            continue

        if estimation_method == "budget":
            budget_amt = _budget_for_category(db, cat.id)
            if budget_amt is None:
                continue
            # Budget amounts are monthly; normalise by type if needed
            estimates.append(CategoryEstimate(
                category_id=cat.id,
                category_name=cat.name,
                monthly_estimate=round(budget_amt, 2),
                estimation_method="budget",
            ))

        elif estimation_method == "prior_month":
            year, month = _months_back(1)[0]
            amt = _category_spending_for_month(db, cat.id, year, month)
            if amt == 0:
                continue
            estimates.append(CategoryEstimate(
                category_id=cat.id,
                category_name=cat.name,
                monthly_estimate=round(amt, 2),
                estimation_method="prior_month",
                months_of_data=1,
            ))

        else:  # avg_months (default)
            months = _months_back(avg_months)
            totals = [_category_spending_for_month(db, cat.id, y, m) for y, m in months]
            non_zero = [t for t in totals if t > 0]
            if not non_zero:
                continue
            avg = sum(non_zero) / len(non_zero)
            estimates.append(CategoryEstimate(
                category_id=cat.id,
                category_name=cat.name,
                monthly_estimate=round(avg, 2),
                estimation_method=f"avg_{avg_months}_months",
                months_of_data=len(non_zero),
            ))

    return estimates


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_latest_snapshot(db: Session) -> models.BalanceSnapshot | None:
    return (
        db.query(models.BalanceSnapshot)
        .order_by(models.BalanceSnapshot.snapshot_date.desc())
        .first()
    )


def _is_fulfilled_early(
    recurring_tx: models.Transaction,
    occ: datetime,
    actual_txs: list,
    today: datetime,
) -> bool:
    """
    Return True if a future recurring occurrence was already paid/received early.
    Only checks transactions within a 7-day grace window before the scheduled date,
    so a normal prior-cycle payment (e.g. last month's paycheck) is never mistaken
    for an early fulfilment of the upcoming occurrence.
    """
    if occ <= today:
        return False
    GRACE_DAYS = 7
    window_start = occ - timedelta(days=GRACE_DAYS)
    # window: [occ - 7 days, occ)  — must be at or after today so we don't
    # match a payment from many weeks ago
    window_start = max(window_start, today - timedelta(days=1))
    tolerance = max(abs(recurring_tx.amount) * 0.02, 1.0)
    target_amount = abs(recurring_tx.amount)
    target_type = recurring_tx.transaction_type
    for tx in actual_txs:
        if tx.id == recurring_tx.id:
            continue
        if tx.transaction_type != target_type:
            continue
        if abs(abs(tx.amount) - target_amount) > tolerance:
            continue
        if not (window_start <= tx.transaction_date < occ):
            continue
        return True
    return False


def _enum_str(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _monthly_amount_per_day(amount: float, frequency: str) -> float:
    """Convert a recurring amount to daily equivalent."""
    mapping = {
        "daily": amount,
        "weekly": amount / 7,
        "bi-weekly": amount / 14,
        "monthly": amount / 30,
        "yearly": amount / 365,
    }
    return mapping.get(frequency, 0.0)


def _occurrences_in_range(
    frequency: str,
    recurring_day: int | None,
    start: datetime,
    end: datetime,
    start_date: datetime | None = None,
    end_date_limit: datetime | None = None,
) -> list[datetime]:
    """Return all occurrence dates for a recurring item within [start, end).
    
    If end_date_limit is set, occurrences after that date are excluded (inclusive cutoff).
    """
    # Apply the recurring end-date cap: if set, the effective range end is the
    # earlier of the projection window end and the day after end_date_limit.
    if end_date_limit is not None:
        cap = end_date_limit + timedelta(days=1)
        if isinstance(cap, datetime):
            end = min(end, cap)
        else:
            end = min(end, datetime.combine(cap, datetime.min.time()))
    occurrences = []
    current = start.date()
    end_date = end.date()

    if frequency == "daily":
        d = current
        while d < end_date:
            occurrences.append(datetime.combine(d, datetime.min.time()))
            d += timedelta(days=1)

    elif frequency == "weekly":
        # Use creation/start_date weekday if available, else Monday
        anchor = (start_date or start).weekday()
        d = current
        while d < end_date:
            if d.weekday() == anchor:
                occurrences.append(datetime.combine(d, datetime.min.time()))
            d += timedelta(days=1)

    elif frequency == "bi-weekly":
        anchor = start_date or start
        d = anchor.date()
        # Move d forward until >= current
        while d < current:
            d += timedelta(days=14)
        while d < end_date:
            occurrences.append(datetime.combine(d, datetime.min.time()))
            d += timedelta(days=14)

    elif frequency == "monthly":
        day = recurring_day or 1
        year, month = current.year, current.month
        while True:
            import calendar
            last_day = calendar.monthrange(year, month)[1]
            actual_day = min(day, last_day)
            candidate = datetime(year, month, actual_day)
            if candidate.date() >= end_date:
                break
            if candidate.date() >= current:
                occurrences.append(candidate)
            month += 1
            if month > 12:
                month = 1
                year += 1

    elif frequency == "yearly":
        anchor = start_date or start
        d = anchor.replace(year=current.year)
        if d.date() < current:
            try:
                d = d.replace(year=current.year + 1)
            except ValueError:
                pass
        while d.date() < end_date:
            occurrences.append(d)
            try:
                d = d.replace(year=d.year + 1)
            except ValueError:
                break

    return occurrences


def _legacy_income_occurrences(
    income: models.Income,
    start: datetime,
    end: datetime,
) -> list[datetime]:
    """Return scheduled occurrences for a legacy recurring income record."""
    if not income.frequency:
        return []
    anchor = income.start_date or income.date
    return _occurrences_in_range(
        income.frequency,
        income.recurring_day,
        start,
        end,
        start_date=anchor,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/snapshot", response_model=SnapshotResponse)
def set_balance_snapshot(payload: SnapshotCreate, db: Session = Depends(database.get_db)):
    """Set or update the user's starting balance."""
    snapshot = models.BalanceSnapshot(
        amount=payload.amount,
        snapshot_date=payload.snapshot_date or datetime.now(),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.get("/current", response_model=CurrentBalanceResponse)
def get_current_balance(db: Session = Depends(database.get_db)):
    """Return the current balance = snapshot + income transactions - expense transactions since snapshot."""
    snapshot = _get_latest_snapshot(db)
    if not snapshot:
        return CurrentBalanceResponse(
            current_balance=0.0,
            snapshot_amount=0.0,
            snapshot_date=datetime.now(),
            total_income_since=0.0,
            total_expenses_since=0.0,
        )

    since = snapshot.snapshot_date
    now = datetime.now()
    liability_ids = _liability_account_ids(db)

    base_q = db.query(models.Transaction).filter(
        models.Transaction.transaction_date >= since,
        (models.Transaction.account_id == None) | (~models.Transaction.account_id.in_(liability_ids)) if liability_ids else True,
    )
    income_txs = base_q.filter(
        models.Transaction.transaction_type == models.TransactionType.INCOME,
    ).all()
    expense_txs = base_q.filter(
        models.Transaction.transaction_type == models.TransactionType.EXPENSE,
    ).all()

    total_income = sum(abs(t.amount) for t in income_txs)
    total_expenses = sum(abs(t.amount) for t in expense_txs)

    legacy_income_total = 0.0
    for income in db.query(models.Income).all():
        for occ in _legacy_income_occurrences(income, since, now):
            if occ >= since and occ <= now:
                legacy_income_total += abs(income.amount)

    total_income += legacy_income_total
    current = snapshot.amount + total_income - total_expenses

    return CurrentBalanceResponse(
        current_balance=round(current, 2),
        snapshot_amount=snapshot.amount,
        snapshot_date=snapshot.snapshot_date,
        total_income_since=round(total_income, 2),
        total_expenses_since=round(total_expenses, 2),
    )


@router.get("/history", response_model=List[ProjectionPoint])
def get_balance_history(db: Session = Depends(database.get_db)):
    """
    Return day-by-day actual balance from the earliest available data through today.
    Reconstructs historical balance by:
    1. Using the most recent BalanceSnapshot as today's anchor.
    2. Walking backward using all transactions to infer prior-day balances.
    3. Includes both Plaid and manually-entered transactions.
    """
    from collections import defaultdict
    
    snapshot = _get_latest_snapshot(db)
    if not snapshot:
        return []

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Determine lookback range: show only last 7 days of history
    earliest = today - timedelta(days=7)
    
    # Exclude credit-card / loan / investment accounts from balance maths
    liability_ids = _liability_account_ids(db)
    
    # Collect all transactions in range
    txns_q = db.query(models.Transaction).filter(
        models.Transaction.transaction_date >= earliest,
        models.Transaction.transaction_type.in_([
            models.TransactionType.INCOME,
            models.TransactionType.EXPENSE,
        ]),
    )
    if liability_ids:
        txns_q = txns_q.filter((models.Transaction.account_id == None) | (~models.Transaction.account_id.in_(liability_ids)))
    txns = txns_q.all()

    daily_net: dict[str, float] = defaultdict(float)
    for tx in txns:
        d = tx.transaction_date.strftime("%Y-%m-%d")
        if tx.transaction_type == models.TransactionType.INCOME:
            daily_net[d] += abs(tx.amount)
        else:
            daily_net[d] -= abs(tx.amount)

    # Include legacy income occurrences
    for income in db.query(models.Income).all():
        for occ in _legacy_income_occurrences(income, earliest, today + timedelta(days=1)):
            if occ >= earliest and occ <= today + timedelta(days=1):
                d = occ.strftime("%Y-%m-%d")
                daily_net[d] += abs(income.amount)

    # Walk backward from snapshot date to earliest
    result = []
    bal = snapshot.amount
    snapshot_day = snapshot.snapshot_date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    bal_backwards = bal
    d_back = snapshot_day
    backwards_entries = []
    while d_back >= earliest:
        date_key = d_back.strftime("%Y-%m-%d")
        backwards_entries.append(ProjectionPoint(date=date_key, balance=round(bal_backwards, 2)))
        # Reverse-apply this day's net to get the balance at end of previous day
        bal_backwards -= daily_net.get(date_key, 0.0)
        d_back -= timedelta(days=1)
    
    # Reverse to get chronological order (earliest to snapshot date)
    backwards_entries.reverse()
    result.extend(backwards_entries)
    
    # Walk forward from day after snapshot through today
    bal = snapshot.amount
    d = snapshot_day + timedelta(days=1)
    while d <= today:
        date_key = d.strftime("%Y-%m-%d")
        bal += daily_net.get(date_key, 0.0)
        result.append(ProjectionPoint(date=date_key, balance=round(bal, 2)))
        d += timedelta(days=1)

    return result


@router.get("/projection", response_model=List[ProjectionPoint])
def get_balance_projection(
    days: int = Query(default=90, ge=1, le=365),
    estimation_method: str = Query(default="budget", pattern="^(prior_month|avg_months|budget|none)$"),
    avg_months: int = Query(default=3, ge=1, le=24),
    from_snapshot: bool = Query(default=False),
    db: Session = Depends(database.get_db),
):
    """
    Project the balance forward `days` days from today.

    Combines:
    1. Recurring transactions (is_recurring=True) — applied on their exact schedule.
    2. Variable spending categories (e.g. Food, Gas) — estimated monthly amount
       spread evenly across each day, using the chosen estimation_method.
    """
    snapshot = _get_latest_snapshot(db)
    baseline = snapshot.amount if snapshot else 0.0

    # Calculate current balance first using actual transactions
    # Exclude credit-card / loan / investment accounts from balance maths.
    # Use >= to include transactions on the snapshot date.
    liability_ids = _liability_account_ids(db)
    if snapshot:
        since = snapshot.snapshot_date
        txn_base = db.query(models.Transaction).filter(
            models.Transaction.transaction_date >= since,
        )
        if liability_ids:
            txn_base = txn_base.filter((models.Transaction.account_id == None) | (~models.Transaction.account_id.in_(liability_ids)))
        income_txs = txn_base.filter(
            models.Transaction.transaction_type == models.TransactionType.INCOME,
        ).all()
        expense_txs = txn_base.filter(
            models.Transaction.transaction_type == models.TransactionType.EXPENSE,
        ).all()
        baseline = (
            snapshot.amount
            + sum(abs(t.amount) for t in income_txs)
            - sum(abs(t.amount) for t in expense_txs)
        )

        legacy_income_total = 0.0
        now = datetime.now()
        for income in db.query(models.Income).all():
            for occ in _legacy_income_occurrences(income, since, now):
                if occ > since and occ <= now:
                    legacy_income_total += abs(income.amount)

        baseline += legacy_income_total

    # Save the actual current balance before it may be overridden below.
    actual_current_balance = baseline

    # Fetch all recurring transactions (exclude transfers — they are net-zero)
    recurring_txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.is_recurring == True,
            models.Transaction.transaction_type.in_([
                models.TransactionType.INCOME,
                models.TransactionType.EXPENSE,
            ]),
        )
        .all()
    )

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    end = today + timedelta(days=days)

    # When from_snapshot=True: project from snapshot date using raw snapshot amount,
    # so the projected line covers the same historical range as the actual line.
    if from_snapshot and snapshot:
        baseline = snapshot.amount
        start = snapshot.snapshot_date.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = today

    # Build a day-by-day delta map
    daily_delta: dict[str, float] = {}
    for i in range((end - start).days + 1):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        daily_delta[d] = 0.0

    # Preload actual transactions for early-payment detection (one year lookback covers all frequencies)
    # Exclude credit-card/loan/investment accounts throughout.
    actual_txs_q = db.query(models.Transaction).filter(
        models.Transaction.transaction_date >= start - timedelta(days=366),
        models.Transaction.transaction_date < end,
        models.Transaction.transaction_type.in_([
            models.TransactionType.INCOME,
            models.TransactionType.EXPENSE,
        ]),
    )
    if liability_ids:
        actual_txs_q = actual_txs_q.filter((models.Transaction.account_id == None) | (~models.Transaction.account_id.in_(liability_ids)))
    actual_txs_for_check = actual_txs_q.all()
    legacy_income_txs = db.query(models.Income).all()

    # --- Recurring transactions (scheduled on exact days) ---
    for tx in recurring_txs:
        if not tx.recurring_frequency:
            continue
        amount = abs(tx.amount)
        is_income = _enum_str(tx.transaction_type) == "income"
        sign = 1 if is_income else -1

        for occ in _occurrences_in_range(
            tx.recurring_frequency,
            tx.recurring_day,
            start,
            end,
            tx.recurring_start_date or tx.transaction_date,
            end_date_limit=tx.recurring_end_date,
        ):
            key = occ.strftime("%Y-%m-%d")
            if key in daily_delta:
                if _is_fulfilled_early(tx, occ, actual_txs_for_check, today):
                    continue  # payment already came out early
                daily_delta[key] += sign * amount

    # --- Legacy recurring incomes (from /api/incomes) ---
    for income in legacy_income_txs:
        for occ in _legacy_income_occurrences(income, start, end):
            key = occ.strftime("%Y-%m-%d")
            if key in daily_delta:
                daily_delta[key] += abs(income.amount)

    # --- Variable spending (prorated per calendar month) ---
    if estimation_method != "none":
        import calendar as _cal
        estimates = _compute_variable_estimates(db, estimation_method, avg_months)

        for est in estimates:
            # Group projected days by (year, month)
            from collections import defaultdict
            by_month: dict[tuple, list[str]] = defaultdict(list)
            for key in daily_delta:
                dt = datetime.strptime(key, "%Y-%m-%d")
                by_month[(dt.year, dt.month)].append(key)

            for (yr, mo), keys in by_month.items():
                days_in_month = _cal.monthrange(yr, mo)[1]

                if not from_snapshot and yr == today.year and mo == today.month:
                    # Current month: subtract already-spent, spread remainder over remaining days
                    month_start = datetime(yr, mo, 1)
                    month_end_so_far = today  # up to (but not including) today
                    already_spent = _category_spending_for_range(
                        db, est.category_id, month_start, month_end_so_far
                    )
                    remaining_budget = max(est.monthly_estimate - already_spent, 0.0)
                    remaining_days = len(keys)  # projected days left in this month
                    daily_cost = remaining_budget / remaining_days if remaining_days else 0.0
                else:
                    # Future month: full estimate spread over its projected days
                    projected_days = len(keys)
                    daily_cost = est.monthly_estimate / days_in_month if days_in_month else 0.0
                    # Scale down if we only project a partial month
                    if projected_days < days_in_month:
                        daily_cost = est.monthly_estimate / days_in_month

                for key in keys:
                    daily_delta[key] -= daily_cost

    # --- Planned one-time expenses ---
    planned = db.query(models.PlannedExpense).all()
    for pe in planned:
        key = pe.planned_date.strftime("%Y-%m-%d")
        if key in daily_delta:
            daily_delta[key] -= abs(pe.amount)

    # --- Planned one-time income ---
    planned_income = db.query(models.PlannedIncome).all()
    for pi in planned_income:
        key = pi.planned_date.strftime("%Y-%m-%d")
        if key in daily_delta:
            daily_delta[key] += abs(pi.amount)

    # Accumulate into running balance.
    # When from_snapshot=True the baseline is the raw snapshot amount, so the
    # projected line may diverge from the actual current balance over time.
    # Re-anchor: once the loop reaches today, compute an adjustment so that the
    # projected balance at today equals the actual current balance.  All future
    # dates are shifted by the same amount, giving an accurate forward forecast
    # while keeping the historical comparison line intact.
    today_str = today.strftime("%Y-%m-%d")
    result = []
    running = baseline
    adjustment = 0.0
    for key in sorted(daily_delta.keys()):
        running += daily_delta[key]
        if from_snapshot and snapshot and key == today_str:
            adjustment = actual_current_balance - running
        result.append(ProjectionPoint(date=key, balance=round(running + adjustment, 2)))

    return result


@router.get("/variable-spending", response_model=List[CategoryEstimate])
def get_variable_spending_estimates(
    estimation_method: str = Query(default="budget", pattern="^(prior_month|avg_months|budget)$"),
    avg_months: int = Query(default=3, ge=1, le=24),
    db: Session = Depends(database.get_db),
):
    """
    Returns the per-category monthly estimates used by the projection.
    Useful for showing the user a breakdown of what's factored in.
    """
    return _compute_variable_estimates(db, estimation_method, avg_months)


@router.get("/projection-breakdown", response_model=List[BreakdownDay])
def get_projection_breakdown(
    days: int = Query(default=90, ge=1, le=365),
    estimation_method: str = Query(default="budget", pattern="^(prior_month|avg_months|budget|none)$"),
    avg_months: int = Query(default=3, ge=1, le=24),
    from_snapshot: bool = Query(default=False),
    db: Session = Depends(database.get_db),
):
    """
    Returns per-day breakdowns of all scheduled items (recurring + planned expenses)
    that contribute to the projection, plus a daily variable spending summary.
    Only days with at least one discrete event are returned.
    """
    from collections import defaultdict
    import calendar as _cal

    snapshot = _get_latest_snapshot(db)
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    start = snapshot.snapshot_date.replace(hour=0, minute=0, second=0, microsecond=0) if (from_snapshot and snapshot) else today
    end = today + timedelta(days=days)

    # day_items[date_str] = list of BreakdownItem
    day_items: dict[str, list] = defaultdict(list)

    # Preload actual transactions for early-payment detection
    liability_ids = _liability_account_ids(db)
    _atx_q = db.query(models.Transaction).filter(
        models.Transaction.transaction_date >= start - timedelta(days=366),
        models.Transaction.transaction_date < end,
        models.Transaction.transaction_type.in_([
            models.TransactionType.INCOME,
            models.TransactionType.EXPENSE,
        ]),
    )
    if liability_ids:
        _atx_q = _atx_q.filter((models.Transaction.account_id == None) | (~models.Transaction.account_id.in_(liability_ids)))
    actual_txs_for_check = _atx_q.all()
    legacy_income_txs = db.query(models.Income).all()

    # --- Recurring transactions (exclude transfers) ---
    recurring_txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.is_recurring == True,
            models.Transaction.transaction_type.in_([
                models.TransactionType.INCOME,
                models.TransactionType.EXPENSE,
            ]),
        )
        .all()
    )
    for tx in recurring_txs:
        if not tx.recurring_frequency:
            continue
        is_income = _enum_str(tx.transaction_type) == "income"
        signed_amount = abs(tx.amount) if is_income else -abs(tx.amount)
        label = (tx.description or "Recurring")[:45]
        for occ in _occurrences_in_range(
            tx.recurring_frequency,
            tx.recurring_day,
            start,
            end,
            tx.recurring_start_date or tx.transaction_date,
            end_date_limit=tx.recurring_end_date,
        ):
            key = occ.strftime("%Y-%m-%d")
            if key in day_items or (start <= occ < end):
                if _is_fulfilled_early(tx, occ, actual_txs_for_check, today):
                    continue  # payment already came out early
                day_items[key].append(BreakdownItem(label=label, amount=round(signed_amount, 2)))

    for income in legacy_income_txs:
        label = (income.source or "Income")[:45]
        for occ in _legacy_income_occurrences(income, start, end):
            key = occ.strftime("%Y-%m-%d")
            if key in day_items or (start <= occ < end):
                day_items[key].append(BreakdownItem(
                    label=f"{label} (income schedule)",
                    amount=round(abs(income.amount), 2),
                ))

    # --- Planned one-time expenses ---
    planned = db.query(models.PlannedExpense).all()
    for pe in planned:
        key = pe.planned_date.strftime("%Y-%m-%d")
        start_key = start.strftime("%Y-%m-%d")
        end_key = end.strftime("%Y-%m-%d")
        if start_key <= key <= end_key:
            day_items[key].append(BreakdownItem(
                label=f"📅 {pe.description} (planned)",
                amount=-abs(pe.amount),
            ))

    # --- Planned one-time income ---
    planned_income = db.query(models.PlannedIncome).all()
    for pi in planned_income:
        key = pi.planned_date.strftime("%Y-%m-%d")
        start_key = start.strftime("%Y-%m-%d")
        end_key = end.strftime("%Y-%m-%d")
        if start_key <= key <= end_key:
            day_items[key].append(BreakdownItem(
                label=f"💰 {pi.description} (planned income)",
                amount=abs(pi.amount),
            ))

    # --- Variable spending: compute total daily rate and attach to event days only ---
    if estimation_method != "none":
        estimates = _compute_variable_estimates(db, estimation_method, avg_months)
        # Compute a per-month daily cost (varies by month length)
        for key in sorted(day_items.keys()):
            dt = datetime.strptime(key, "%Y-%m-%d")
            days_in_month = _cal.monthrange(dt.year, dt.month)[1]
            daily_var = sum(e.monthly_estimate / days_in_month for e in estimates)
            if daily_var > 0:
                day_items[key].append(BreakdownItem(
                    label="Variable spending (est.)",
                    amount=-round(daily_var, 2),
                ))

    # Sort each day's items: income first, then expenses
    result = []
    for key in sorted(day_items.keys()):
        items = sorted(day_items[key], key=lambda x: (-x.amount))
        result.append(BreakdownDay(date=key, items=items))

    return result


# ---------------------------------------------------------------------------
# Planned Expenses (one-time future costs factored into projection)
# ---------------------------------------------------------------------------

@router.post("/planned-expenses", response_model=PlannedExpenseResponse)
def create_planned_expense(payload: PlannedExpenseCreate, db: Session = Depends(database.get_db)):
    item = models.PlannedExpense(
        description=payload.description,
        amount=payload.amount,
        planned_date=payload.planned_date,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/planned-expenses", response_model=List[PlannedExpenseResponse])
def list_planned_expenses(db: Session = Depends(database.get_db)):
    return db.query(models.PlannedExpense).order_by(models.PlannedExpense.planned_date).all()


@router.delete("/planned-expenses/{expense_id}")
def delete_planned_expense(expense_id: int, db: Session = Depends(database.get_db)):
    item = db.query(models.PlannedExpense).filter(models.PlannedExpense.id == expense_id).first()
    if item:
        db.delete(item)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Planned Income (one-time expected income events factored into projection)
# ---------------------------------------------------------------------------

@router.post("/planned-incomes", response_model=PlannedIncomeResponse)
def create_planned_income(payload: PlannedIncomeCreate, db: Session = Depends(database.get_db)):
    item = models.PlannedIncome(
        description=payload.description,
        amount=payload.amount,
        planned_date=payload.planned_date,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/planned-incomes", response_model=List[PlannedIncomeResponse])
def list_planned_incomes(db: Session = Depends(database.get_db)):
    return db.query(models.PlannedIncome).order_by(models.PlannedIncome.planned_date).all()


@router.delete("/planned-incomes/{income_id}")
def delete_planned_income(income_id: int, db: Session = Depends(database.get_db)):
    item = db.query(models.PlannedIncome).filter(models.PlannedIncome.id == income_id).first()
    if item:
        db.delete(item)
        db.commit()
    return {"ok": True}

