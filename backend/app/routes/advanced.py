from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, database
from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime

router = APIRouter()

# Pydantic Models
class AccountCreate(BaseModel):
    name: str
    type: str
    balance: float = 0.0
    currency: str = "USD"
    institution: Optional[str] = None
    account_number: Optional[str] = None

class AccountResponse(BaseModel):
    id: int
    name: str
    type: str
    balance: float
    currency: str
    institution: Optional[str]
    account_number: Optional[str]
    is_active: bool
    created_at: datetime

class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    color: str = "#3498db"
    icon: Optional[str] = None
    is_income: bool = False
    is_savings: bool = False

class CategoryResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    color: str
    icon: Optional[str]
    is_income: bool
    is_savings: bool
    is_active: bool
    created_at: datetime

class TransactionCreate(BaseModel):
    account_id: int
    category_id: Optional[int]
    amount: float
    description: str
    notes: Optional[str] = None
    transaction_type: str
    transaction_date: datetime
    is_recurring: bool = False
    recurring_frequency: Optional[str] = None  # daily | weekly | bi-weekly | monthly | yearly
    recurring_day: Optional[int] = None         # day-of-month for monthly
    recurring_start_date: Optional[datetime] = None  # anchor for weekly/bi-weekly
    recurring_end_date: Optional[datetime] = None    # last occurrence date (inclusive)

    @field_validator("transaction_type", mode="before")
    @classmethod
    def _upper_type(cls, v):
        return v.upper() if isinstance(v, str) else v
    tags: Optional[str] = None

class TransactionResponse(BaseModel):
    id: int
    account_id: Optional[int] = None
    category_id: Optional[int]
    amount: float
    description: str
    notes: Optional[str]
    transaction_type: str
    transaction_date: datetime
    is_recurring: bool
    recurring_frequency: Optional[str] = None
    recurring_day: Optional[int] = None
    recurring_start_date: Optional[datetime] = None
    recurring_end_date: Optional[datetime] = None
    tags: Optional[str]
    created_at: datetime

class BudgetCreate(BaseModel):
    category_id: Optional[int] = None
    name: str
    budget_type: str = "monthly"
    amount: float
    # Optional: if omitted the budget covers all months (past and future).
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None

class BudgetUpdate(BaseModel):
    amount: float

class BudgetResponse(BaseModel):
    id: int
    category_id: Optional[int]
    name: str
    budget_type: str
    amount: float
    spent: float
    period_start: datetime
    period_end: datetime
    is_active: bool
    created_at: datetime

class GoalCreate(BaseModel):
    name: str
    goal_type: str
    target_amount: float
    target_date: Optional[datetime] = None
    description: Optional[str] = None
    priority: int = 1

class GoalResponse(BaseModel):
    id: int
    name: str
    goal_type: str
    target_amount: float
    current_amount: float
    target_date: Optional[datetime]
    description: Optional[str]
    priority: int
    is_completed: bool
    completed_at: Optional[datetime]
    created_at: datetime

# Account Endpoints
@router.post("/accounts/", response_model=AccountResponse)
def create_account(account: AccountCreate, db: Session = Depends(database.get_db)):
    db_account = models.Account(**account.dict())
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

@router.get("/accounts/", response_model=List[AccountResponse])
def get_accounts(db: Session = Depends(database.get_db)):
    return db.query(models.Account).filter(models.Account.is_active == True).all()

@router.get("/accounts/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(database.get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

@router.put("/accounts/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, account: AccountCreate, db: Session = Depends(database.get_db)):
    db_account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")
    for key, value in account.dict().items():
        setattr(db_account, key, value)
    db.commit()
    db.refresh(db_account)
    return db_account

@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(database.get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.is_active = False
    db.commit()
    return {"message": "Account deactivated"}

# Category Endpoints
@router.post("/categories/", response_model=CategoryResponse)
def create_category(category: CategoryCreate, db: Session = Depends(database.get_db)):
    db_category = models.Category(**category.dict())
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category

@router.get("/categories/", response_model=List[CategoryResponse])
def get_categories(db: Session = Depends(database.get_db)):
    return db.query(models.Category).filter(models.Category.is_active == True).all()

@router.get("/categories/{category_id}", response_model=CategoryResponse)
def get_category(category_id: int, db: Session = Depends(database.get_db)):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category

@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(database.get_db)):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    category.is_active = False
    db.commit()
    return {"message": "Category deleted"}

# Transaction Endpoints
@router.post("/transactions/", response_model=TransactionResponse)
def create_transaction(transaction: TransactionCreate, db: Session = Depends(database.get_db)):
    db_transaction = models.Transaction(**transaction.dict())
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

@router.get("/transactions/recurring", response_model=List[TransactionResponse])
def get_recurring_transactions(db: Session = Depends(database.get_db)):
    return (
        db.query(models.Transaction)
        .filter(models.Transaction.is_recurring == True)
        .order_by(models.Transaction.recurring_frequency, models.Transaction.description)
        .all()
    )

@router.get("/transactions/", response_model=List[TransactionResponse])
def get_transactions(
    skip: int = 0,
    limit: int = 100,
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(database.get_db)
):
    query = db.query(models.Transaction)
    if account_id:
        query = query.filter(models.Transaction.account_id == account_id)
    if category_id:
        query = query.filter(models.Transaction.category_id == category_id)
    return query.order_by(models.Transaction.transaction_date.desc()).offset(skip).limit(limit).all()

@router.get("/transactions/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: int, db: Session = Depends(database.get_db)):
    transaction = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction

@router.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, db: Session = Depends(database.get_db)):
    transaction = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(transaction)
    db.commit()
    return {"message": "Transaction deleted"}

class TransactionPatch(BaseModel):
    transaction_type: Optional[str] = None
    category_id: Optional[int] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    is_recurring: Optional[bool] = None
    recurring_frequency: Optional[str] = None
    recurring_day: Optional[int] = None
    recurring_start_date: Optional[datetime] = None
    recurring_end_date: Optional[datetime] = None

@router.patch("/transactions/{transaction_id}", response_model=TransactionResponse)
def patch_transaction(transaction_id: int, body: TransactionPatch, db: Session = Depends(database.get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if body.transaction_type is not None:
        try:
            tx.transaction_type = models.TransactionType(body.transaction_type.lower())
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid type: {body.transaction_type}")
    if body.category_id is not None:
        tx.category_id = body.category_id
        tx.user_confirmed_category = True
    if "category_id" in body.model_fields_set and body.category_id is None:
        tx.category_id = None
        tx.user_confirmed_category = True
    if body.description is not None:
        tx.description = body.description
    if body.amount is not None:
        tx.amount = body.amount
    if body.is_recurring is not None:
        tx.is_recurring = body.is_recurring
    if "recurring_frequency" in body.model_fields_set:
        tx.recurring_frequency = body.recurring_frequency
    if "recurring_day" in body.model_fields_set:
        tx.recurring_day = body.recurring_day
    if "recurring_start_date" in body.model_fields_set:
        tx.recurring_start_date = body.recurring_start_date
    if "recurring_end_date" in body.model_fields_set:
        tx.recurring_end_date = body.recurring_end_date
    db.commit()
    db.refresh(tx)
    return tx

# Budget Endpoints
@router.post("/budgets/", response_model=BudgetResponse)
def create_budget(budget: BudgetCreate, db: Session = Depends(database.get_db)):
    _FAR_PAST   = datetime(1900, 1, 1)
    _FAR_FUTURE = datetime(2099, 12, 31, 23, 59, 59)
    data = budget.dict()
    data["period_start"] = data["period_start"] or _FAR_PAST
    data["period_end"]   = data["period_end"]   or _FAR_FUTURE
    db_budget = models.Budget(**data)
    db.add(db_budget)
    db.flush()  # get db_budget.id before commit
    # Insert the initial history row so the amount is tracked from the beginning.
    db.add(models.BudgetHistory(
        budget_id=db_budget.id,
        amount=db_budget.amount,
        effective_from=_FAR_PAST,
    ))
    db.commit()
    db.refresh(db_budget)
    return db_budget


@router.put("/budgets/{budget_id}", response_model=BudgetResponse)
def update_budget(budget_id: int, body: BudgetUpdate, db: Session = Depends(database.get_db)):
    """Update a budget's amount going forward from the start of the current month."""
    b = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    today = datetime.utcnow()
    first_of_month = datetime(today.year, today.month, 1)
    b.amount = body.amount
    db.add(models.BudgetHistory(
        budget_id=b.id,
        amount=body.amount,
        effective_from=first_of_month,
    ))
    db.commit()
    db.refresh(b)
    return b

@router.get("/budgets/", response_model=List[BudgetResponse])
def get_budgets(db: Session = Depends(database.get_db)):
    return db.query(models.Budget).filter(models.Budget.is_active == True).all()

@router.get("/budgets/{budget_id}", response_model=BudgetResponse)
def get_budget(budget_id: int, db: Session = Depends(database.get_db)):
    budget = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    return budget

@router.delete("/budgets/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(database.get_db)):
    budget = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    budget.is_active = False
    db.commit()
    return {"message": "Budget deleted"}

# Goal Endpoints
@router.post("/goals/", response_model=GoalResponse)
def create_goal(goal: GoalCreate, db: Session = Depends(database.get_db)):
    db_goal = models.Goal(**goal.dict())
    db.add(db_goal)
    db.commit()
    db.refresh(db_goal)
    return db_goal

@router.get("/goals/", response_model=List[GoalResponse])
def get_goals(db: Session = Depends(database.get_db)):
    return db.query(models.Goal).filter(models.Goal.is_completed == False).all()

@router.get("/goals/{goal_id}", response_model=GoalResponse)
def get_goal(goal_id: int, db: Session = Depends(database.get_db)):
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal

from app.services.analytics import AnalyticsService

# Analytics Endpoints
@router.get("/analytics/summary")
def get_financial_summary(db: Session = Depends(database.get_db)):
    """Get comprehensive financial summary"""
    analytics = AnalyticsService(db)
    return analytics.get_financial_summary()

@router.get("/analytics/spending-by-category")
def get_spending_by_category(months: int = 3, db: Session = Depends(database.get_db)):
    """Get spending breakdown by category"""
    analytics = AnalyticsService(db)
    return analytics.get_spending_by_category(months)

@router.get("/analytics/budget-performance")
def get_budget_performance(db: Session = Depends(database.get_db)):
    """Get budget vs actual performance"""
    analytics = AnalyticsService(db)
    return analytics.get_budget_performance()

@router.get("/analytics/cash-flow-forecast")
def get_cash_flow_forecast(months: int = 6, db: Session = Depends(database.get_db)):
    """Get cash flow forecast"""
    analytics = AnalyticsService(db)
    return analytics.get_cash_flow_forecast(months)

@router.get("/analytics/financial-health")
def get_financial_health_score(db: Session = Depends(database.get_db)):
    """Get financial health score and recommendations"""
    analytics = AnalyticsService(db)
    return analytics.get_financial_health_score()

@router.get("/analytics/spending-trends")
def get_spending_trends(months: int = 12, db: Session = Depends(database.get_db)):
    """Get spending trends over time"""
    analytics = AnalyticsService(db)
    return analytics.get_spending_trends(months)

@router.get("/analytics/top-categories")
def get_top_spending_categories(limit: int = 5, db: Session = Depends(database.get_db)):
    """Get top spending categories"""
    analytics = AnalyticsService(db)
    return analytics.get_top_spending_categories(limit)


# ── App Settings ───────────────────────────────────────────────────────────

class SettingUpdate(BaseModel):
    value: str

_ALLOWED_SETTINGS = {"savings_base_balance"}

@router.get("/settings")
def get_settings(db: Session = Depends(database.get_db)):
    return {row.key: row.value for row in db.query(models.AppSettings).all()}

@router.put("/settings/{key}")
def update_setting(key: str, body: SettingUpdate, db: Session = Depends(database.get_db)):
    if key not in _ALLOWED_SETTINGS:
        raise HTTPException(status_code=400, detail=f"Unknown setting key: {key}")
    setting = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    if setting:
        setting.value = body.value
    else:
        db.add(models.AppSettings(key=key, value=body.value))
    db.commit()
    return {"key": key, "value": body.value}


# ── Transfer management ────────────────────────────────────────────────────

@router.post("/transactions/detect-transfers")
def detect_transfers(db: Session = Depends(database.get_db)):
    """
    Auto-detect inter-account transfers by matching equal absolute amounts
    across different accounts within 3 days of each other.
    Both sides are re-typed to TRANSFER so they are excluded from all calculations.
    """
    from datetime import timedelta

    txns = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.transaction_type != models.TransactionType.TRANSFER,
        )
        .order_by(models.Transaction.transaction_date)
        .all()
    )

    expenses = [t for t in txns if t.transaction_type == models.TransactionType.EXPENSE]
    incomes  = [t for t in txns if t.transaction_type == models.TransactionType.INCOME]

    matched: set = set()
    pairs = 0

    for exp in expenses:
        if exp.id in matched:
            continue
        exp_amt = abs(exp.amount)
        for inc in incomes:
            if inc.id in matched:
                continue
            # Skip only when BOTH have the same non-None account — don't skip None==None
            if inc.account_id is not None and inc.account_id == exp.account_id:
                continue
            if abs(abs(inc.amount) - exp_amt) > 0.01:
                continue
            if abs((inc.transaction_date - exp.transaction_date).days) > 3:
                continue
            # Found a matching pair — mark both as transfers
            exp.transaction_type = models.TransactionType.TRANSFER
            inc.transaction_type = models.TransactionType.TRANSFER
            matched.add(exp.id)
            matched.add(inc.id)
            pairs += 1
            break

    db.commit()
    return {"pairs_detected": pairs, "transactions_marked": len(matched)}


@router.post("/transactions/{transaction_id}/toggle-transfer")
def toggle_transfer(transaction_id: int, db: Session = Depends(database.get_db)):
    """Toggle a single transaction between TRANSFER and its original type (inferred from amount sign)."""
    tx = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.transaction_type == models.TransactionType.TRANSFER:
        tx.transaction_type = (
            models.TransactionType.INCOME if tx.amount > 0 else models.TransactionType.EXPENSE
        )
    else:
        tx.transaction_type = models.TransactionType.TRANSFER
    db.commit()
    return {"id": tx.id, "transaction_type": tx.transaction_type.value}


# ── Savings category toggle ────────────────────────────────────────────────

@router.post("/categories/{category_id}/toggle-savings")
def toggle_category_savings(category_id: int, db: Session = Depends(database.get_db)):
    """Toggle the is_savings flag on a category."""
    cat = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    cat.is_savings = not cat.is_savings
    db.commit()
    return {"id": cat.id, "is_savings": cat.is_savings}



@router.get("/analytics/monthly-summary")
def get_monthly_summary(year: int, month: int, db: Session = Depends(database.get_db)):
    """
    Full monthly budget dashboard payload for a given year/month.
    Returns income, expenses, savings contributions, per-category breakdown,
    budget progress, and daily spending.

    - TRANSFER type transactions are excluded from income AND expense totals.
    - Transactions in a savings category (is_savings=True) are excluded from
      expenses and counted separately as savings contributions.
    """
    import calendar
    from sqlalchemy import func

    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="month must be 1–12")

    last_day = calendar.monthrange(year, month)[1]
    start = datetime(year, month, 1, 0, 0, 0)
    end   = datetime(year, month, last_day, 23, 59, 59)

    # ── Savings category IDs ──────────────────────────────────────────
    savings_cat_ids = {
        c.id for c in
        db.query(models.Category)
        .filter(models.Category.is_savings == True, models.Category.is_active == True)
        .all()
    }

    # ── All transactions in the month ─────────────────────────────────
    txns = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.transaction_date >= start,
            models.Transaction.transaction_date <= end,
        )
        .all()
    )

    # Classify transactions
    income_txns   = [t for t in txns if t.transaction_type == models.TransactionType.INCOME]
    transfer_txns = [t for t in txns if t.transaction_type == models.TransactionType.TRANSFER]
    expense_txns  = [
        t for t in txns
        if t.transaction_type == models.TransactionType.EXPENSE
        and t.category_id not in savings_cat_ids
    ]
    savings_txns  = [
        t for t in txns
        if t.transaction_type == models.TransactionType.EXPENSE
        and t.category_id in savings_cat_ids
    ]

    income               = sum(t.amount      for t in income_txns)
    expenses             = sum(abs(t.amount) for t in expense_txns)
    savings_contrib      = sum(abs(t.amount) for t in savings_txns)
    transfers_excluded   = len(transfer_txns)
    net                  = income - expenses - savings_contrib
    savings_rate         = round((income - expenses) / income * 100, 1) if income > 0 else 0.0

    # ── Savings balance (base + all-time contributions) ────────────────
    base_row = (
        db.query(models.AppSettings)
        .filter(models.AppSettings.key == "savings_base_balance")
        .first()
    )
    savings_base = float(base_row.value) if base_row and base_row.value else 0.0

    all_time_savings = db.query(
        func.sum(func.abs(models.Transaction.amount))
    ).join(models.Category, models.Transaction.category_id == models.Category.id).filter(
        models.Category.is_savings == True,
        models.Transaction.transaction_type == models.TransactionType.EXPENSE,
    ).scalar() or 0.0

    total_savings = savings_base + all_time_savings

    # ── Spending by category (exclude savings + transfers) ────────────
    cat_rows = (
        db.query(
            models.Category.id,
            models.Category.name,
            models.Category.color,
            models.Category.icon,
            func.sum(func.abs(models.Transaction.amount)).label("amount"),
            func.count(models.Transaction.id).label("count"),
        )
        .join(models.Transaction, models.Transaction.category_id == models.Category.id)
        .filter(
            models.Transaction.transaction_date >= start,
            models.Transaction.transaction_date <= end,
            models.Transaction.transaction_type == models.TransactionType.EXPENSE,
            models.Category.is_savings == False,
        )
        .group_by(models.Category.id)
        .order_by(func.sum(func.abs(models.Transaction.amount)).desc())
        .all()
    )

    by_category = [
        {
            "category_id":   r.id,
            "category_name": r.name,
            "color":         r.color or "#95a5a6",
            "icon":          r.icon or "",
            "amount":        round(r.amount, 2),
            "count":         r.count,
            "pct":           round(r.amount / expenses * 100, 1) if expenses > 0 else 0.0,
        }
        for r in cat_rows
    ]

    # Uncategorized (non-savings) expenses
    uncat = [
        t for t in txns
        if t.transaction_type == models.TransactionType.EXPENSE
        and t.category_id is None
    ]
    if uncat:
        uncat_amount = sum(abs(t.amount) for t in uncat)
        by_category.append({
            "category_id":   None,
            "category_name": "Uncategorized",
            "color":         "#bdc3c7",
            "icon":          "❓",
            "amount":        round(uncat_amount, 2),
            "count":         len(uncat),
            "pct":           round(uncat_amount / expenses * 100, 1) if expenses > 0 else 0.0,
        })

    # ── Savings contributions by category (for display) ───────────────
    savings_breakdown = []
    for cat_id in savings_cat_ids:
        cat_txns = [t for t in savings_txns if t.category_id == cat_id]
        if not cat_txns:
            continue
        cat = db.query(models.Category).filter(models.Category.id == cat_id).first()
        if not cat:
            continue
        savings_breakdown.append({
            "category_name": cat.name,
            "color":         cat.color or "#2ecc71",
            "icon":          cat.icon or "💰",
            "amount":        round(sum(abs(t.amount) for t in cat_txns), 2),
            "count":         len(cat_txns),
        })

    # ── Budgets that cover the selected month ─────────────────────────
    budgets_q = (
        db.query(models.Budget)
        .filter(
            models.Budget.is_active == True,
            models.Budget.period_start <= end,
            models.Budget.period_end   >= start,
        )
        .all()
    )

    budgets_data = []
    for b in budgets_q:
        # Look up historical amount: most recent BudgetHistory row with
        # effective_from <= first day of the requested month.
        history_entry = (
            db.query(models.BudgetHistory)
            .filter(
                models.BudgetHistory.budget_id == b.id,
                models.BudgetHistory.effective_from <= start,
            )
            .order_by(models.BudgetHistory.effective_from.desc())
            .first()
        )
        budgeted_amount = history_entry.amount if history_entry else b.amount

        spent_q = db.query(
            func.sum(func.abs(models.Transaction.amount))
        ).filter(
            models.Transaction.transaction_date >= start,
            models.Transaction.transaction_date <= end,
            models.Transaction.transaction_type == models.TransactionType.EXPENSE,
        )
        if b.category_id:
            spent_q = spent_q.filter(models.Transaction.category_id == b.category_id)

        spent = spent_q.scalar() or 0.0
        pct   = round(spent / budgeted_amount * 100, 1) if budgeted_amount > 0 else 0.0
        status = "over" if spent > budgeted_amount else ("warning" if pct >= 80 else "ok")

        cat = (
            db.query(models.Category)
            .filter(models.Category.id == b.category_id)
            .first()
        ) if b.category_id else None

        budgets_data.append({
            "id":             b.id,
            "name":           b.name,
            "category_id":    b.category_id,
            "category_name":  cat.name  if cat else None,
            "category_color": cat.color if cat else "#3498db",
            "category_icon":  cat.icon  if cat else None,
            "budgeted":       budgeted_amount,
            "spent":          round(spent, 2),
            "remaining":      round(budgeted_amount - spent, 2),
            "pct":            min(pct, 9999.9),
            "status":         status,
        })

    # ── Daily spending (exclude transfers and savings) ─────────────────
    daily_map: dict = {}
    for t in expense_txns:
        d = t.transaction_date.day
        daily_map[d] = daily_map.get(d, 0.0) + abs(t.amount)

    daily_spending = [round(daily_map.get(d, 0.0), 2) for d in range(1, last_day + 1)]

    # ── Days elapsed ───────────────────────────────────────────────────
    today = datetime.utcnow()
    if today.year == year and today.month == month:
        days_elapsed = today.day
    elif datetime(year, month, 1) > today:
        days_elapsed = 0
    else:
        days_elapsed = last_day

    return {
        "year":                  year,
        "month":                 month,
        "month_name":            start.strftime("%B %Y"),
        "days_in_month":         last_day,
        "days_elapsed":          days_elapsed,
        "income":                round(income, 2),
        "expenses":              round(expenses, 2),
        "savings_contributions": round(savings_contrib, 2),
        "savings_breakdown":     savings_breakdown,
        "savings_base":          round(savings_base, 2),
        "total_savings":         round(total_savings, 2),
        "net":                   round(net, 2),
        "savings":               round(net, 2),        # kept for backward compat
        "savings_rate":          savings_rate,
        "transfers_excluded":    transfers_excluded,
        "by_category":           by_category,
        "budgets":               budgets_data,
        "daily_spending":        daily_spending,
    }