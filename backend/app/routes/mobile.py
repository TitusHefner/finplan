"""
Mobile-optimised endpoints consumed by the iOS SwiftUI app.

All routes live under the /api/mobile prefix (registered in main.py).
They deliberately minimise round-trips by returning composite payloads
and re-use the existing AnalyticsService for all business logic.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import database, models
from app.services.analytics import AnalyticsService

router = APIRouter()


# ── Response models ────────────────────────────────────────────────────────


class MobileSummary(BaseModel):
    total_balance: float
    monthly_income: float
    monthly_expenses: float
    net_savings: float
    savings_rate: float
    health_score: float
    health_grade: str
    accounts_count: int
    transactions_this_month: int


class MobileTransactionItem(BaseModel):
    id: int
    amount: float
    description: str
    transaction_type: str
    transaction_date: datetime
    category_name: Optional[str] = None
    account_name: Optional[str] = None
    tags: Optional[str] = None
    is_recurring: bool = False
    recurring_frequency: Optional[str] = None
    recurring_day: Optional[int] = None
    recurring_start_date: Optional[datetime] = None
    # AI categorisation fields
    ai_category_id: Optional[int] = None
    ai_category_name: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_categorized: bool = False
    user_confirmed_category: bool = False


class MobileTransactionCreate(BaseModel):
    account_id: int
    category_id: Optional[int] = None
    amount: float
    description: str
    notes: Optional[str] = None
    transaction_type: str  # "income" | "expense" | "transfer"
    transaction_date: datetime
    is_recurring: bool = False
    recurring_frequency: Optional[str] = None
    recurring_day: Optional[int] = None
    recurring_start_date: Optional[datetime] = None
    tags: Optional[str] = None

    @field_validator("transaction_type", mode="before")
    @classmethod
    def _upper_type(cls, v):
        return v.upper() if isinstance(v, str) else v


class MobileBudgetItem(BaseModel):
    id: int
    name: str
    budget_type: str
    amount: float
    spent: float
    remaining: float
    percentage_used: float
    status: str  # "on_track" | "warning" | "over"


class MobileAccountItem(BaseModel):
    id: int
    name: str
    type: str
    balance: float
    currency: str
    institution: Optional[str] = None


class MobileDashboard(BaseModel):
    summary: MobileSummary
    recent_transactions: List[MobileTransactionItem]
    budget_overview: List[MobileBudgetItem]
    accounts: List[MobileAccountItem]


# ── Internal helpers ───────────────────────────────────────────────────────


def _enum_str(value) -> str:
    """Return .value for SQLAlchemy enum instances, str otherwise."""
    return value.value if hasattr(value, "value") else str(value)


def _budget_status(pct: float) -> str:
    if pct >= 100:
        return "over"
    if pct >= 80:
        return "warning"
    return "on_track"


def _build_summary(db: Session) -> MobileSummary:
    service = AnalyticsService(db)
    raw = service.get_financial_summary()
    health = service.get_financial_health_score()
    income = raw["monthly_income"]
    expenses = raw["monthly_expenses"]
    return MobileSummary(
        total_balance=raw["total_balance"],
        monthly_income=income,
        monthly_expenses=expenses,
        net_savings=income - expenses,
        savings_rate=raw["savings_rate"],
        health_score=health["overall_score"],
        health_grade=health["grade"],
        accounts_count=raw["accounts_count"],
        transactions_this_month=raw["transactions_count"],
    )


def _build_budget_items(db: Session) -> list[MobileBudgetItem]:
    budgets = (
        db.query(models.Budget).filter(models.Budget.is_active == True).all()
    )
    items: list[MobileBudgetItem] = []
    for b in budgets:
        actual = (
            db.query(func.sum(models.Transaction.amount))
            .filter(
                models.Transaction.category_id == b.category_id,
                models.Transaction.transaction_type == models.TransactionType.EXPENSE,
                models.Transaction.transaction_date.between(
                    b.period_start, b.period_end
                ),
            )
            .scalar()
            or 0.0
        )
        spent = abs(actual)
        pct = (spent / b.amount * 100) if b.amount else 0.0
        items.append(
            MobileBudgetItem(
                id=b.id,
                name=b.name,
                budget_type=_enum_str(b.budget_type),
                amount=b.amount,
                spent=spent,
                remaining=b.amount - spent,
                percentage_used=round(pct, 1),
                status=_budget_status(pct),
            )
        )
    return items


def _build_transaction_item(t: models.Transaction, db: Session) -> MobileTransactionItem:
    cat = db.get(models.Category, t.category_id) if t.category_id else None
    acc = db.get(models.Account, t.account_id) if t.account_id else None
    ai_cat = db.get(models.Category, t.ai_category_id) if t.ai_category_id else None
    return MobileTransactionItem(
        id=t.id,
        amount=t.amount,
        description=t.description,
        transaction_type=_enum_str(t.transaction_type),
        transaction_date=t.transaction_date,
        category_name=cat.name if cat else None,
        account_name=acc.name if acc else None,
        tags=t.tags,
        is_recurring=bool(t.is_recurring),
        recurring_frequency=t.recurring_frequency,
        recurring_day=t.recurring_day,
        recurring_start_date=t.recurring_start_date,
        ai_category_id=t.ai_category_id,
        ai_category_name=ai_cat.name if ai_cat else None,
        ai_confidence=t.ai_confidence,
        ai_categorized=bool(t.ai_categorized),
        user_confirmed_category=bool(t.user_confirmed_category),
    )


def _recent_transactions(db: Session, limit: int = 10) -> list[MobileTransactionItem]:
    rows = (
        db.query(models.Transaction)
        .order_by(models.Transaction.transaction_date.desc())
        .limit(limit)
        .all()
    )
    return [_build_transaction_item(t, db) for t in rows]


# ── Endpoints ──────────────────────────────────────────────────────────────


@router.get("/summary", response_model=MobileSummary)
def get_summary(db: Session = Depends(database.get_db)):
    """
    Financial health summary card.
    Powers the top section of the iOS home screen.
    """
    return _build_summary(db)


@router.get("/dashboard", response_model=MobileDashboard)
def get_dashboard(db: Session = Depends(database.get_db)):
    """
    Single endpoint that drives the iOS home screen.
    Returns summary, 10 recent transactions, budget progress, and accounts.
    """
    accounts = (
        db.query(models.Account)
        .filter(models.Account.is_active == True)
        .all()
    )
    return MobileDashboard(
        summary=_build_summary(db),
        recent_transactions=_recent_transactions(db, limit=10),
        budget_overview=_build_budget_items(db),
        accounts=[
            MobileAccountItem(
                id=a.id,
                name=a.name,
                type=_enum_str(a.type),
                balance=a.balance,
                currency=a.currency,
                institution=a.institution,
            )
            for a in accounts
        ],
    )


@router.get("/transactions", response_model=List[MobileTransactionItem])
def list_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    transaction_type: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    description: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    amount_min: Optional[float] = Query(None),
    amount_max: Optional[float] = Query(None),
    db: Session = Depends(database.get_db),
):
    """
    Paginated transaction list with optional type/account/category/description/date/amount filters.
    The iOS app calls this with skip= for infinite-scroll pagination.
    """
    q = db.query(models.Transaction).order_by(
        models.Transaction.transaction_date.desc()
    )
    if transaction_type:
        q = q.filter(models.Transaction.transaction_type == transaction_type)
    if account_id:
        q = q.filter(models.Transaction.account_id == account_id)
    if category_id:
        q = q.filter(models.Transaction.category_id == category_id)
    if description:
        q = q.filter(models.Transaction.description.ilike(f"%{description}%"))
    if date_from:
        q = q.filter(models.Transaction.transaction_date >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(models.Transaction.transaction_date <= datetime.fromisoformat(date_to + "T23:59:59"))
    if amount_min is not None:
        q = q.filter(func.abs(models.Transaction.amount) >= amount_min)
    if amount_max is not None:
        q = q.filter(func.abs(models.Transaction.amount) <= amount_max)

    rows = q.offset(skip).limit(limit).all()
    return [_build_transaction_item(t, db) for t in rows]


@router.post("/transactions", response_model=MobileTransactionItem, status_code=201)
def create_transaction(
    payload: MobileTransactionCreate,
    db: Session = Depends(database.get_db),
):
    """
    Create a new transaction from the iOS Add Transaction form.
    Returns the enriched MobileTransactionItem so the Swift list can update immediately.
    """
    from app.services.ai_service import categorize_transaction

    db_tx = models.Transaction(
        account_id=payload.account_id,
        category_id=payload.category_id,
        amount=payload.amount,
        description=payload.description,
        notes=payload.notes,
        transaction_type=payload.transaction_type,
        transaction_date=payload.transaction_date,
        is_recurring=payload.is_recurring,
        tags=payload.tags,
    )

    # Auto-categorise if no category was specified
    if not payload.category_id:
        cat_id, confidence, _ = categorize_transaction(payload.description, db)
        db_tx.category_id = cat_id
        db_tx.ai_category_id = cat_id
        db_tx.ai_confidence = confidence
        db_tx.ai_categorized = True
        db_tx.user_confirmed_category = False
    else:
        db_tx.user_confirmed_category = True

    db.add(db_tx)
    db.commit()
    db.refresh(db_tx)
    return _build_transaction_item(db_tx, db)


# ── AI Category Review Endpoints ───────────────────────────────────────────


class ReviewQueueItem(BaseModel):
    """A transaction awaiting user confirmation of its AI-suggested category."""
    id: int
    amount: float
    description: str
    transaction_type: str
    transaction_date: datetime
    account_name: Optional[str] = None
    # Current (AI) suggestion
    ai_category_id: Optional[int] = None
    ai_category_name: Optional[str] = None
    ai_confidence: Optional[float] = None
    # Available category choices (full list)
    available_categories: List[dict] = []


class CategoryUpdateRequest(BaseModel):
    category_id: int
    confirm: bool = True  # False = user picked a different category; True = user confirmed AI suggestion


@router.get("/accounts", response_model=List[MobileAccountItem])
def get_mobile_accounts(db: Session = Depends(database.get_db)):
    """All active accounts, formatted for the mobile accounts tab."""
    accounts = (
        db.query(models.Account)
        .filter(models.Account.is_active == True)
        .all()
    )
    return [
        MobileAccountItem(
            id=a.id,
            name=a.name,
            type=_enum_str(a.type),
            balance=a.balance,
            currency=a.currency,
            institution=a.institution,
        )
        for a in accounts
    ]


@router.get("/review", response_model=List[ReviewQueueItem])
def get_review_queue(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(database.get_db),
):
    """
    Transactions that the AI categorised but the user has not yet confirmed.
    The frontend shows these in a swipe-to-approve card deck.
    """
    txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.ai_categorized == True,
            models.Transaction.user_confirmed_category == False,
        )
        .order_by(models.Transaction.transaction_date.desc())
        .limit(limit)
        .all()
    )

    categories = db.query(models.Category).filter(models.Category.is_active == True).all()
    cat_choices = [{"id": c.id, "name": c.name, "is_income": c.is_income} for c in categories]

    items = []
    for t in txs:
        acc = db.get(models.Account, t.account_id) if t.account_id else None
        ai_cat = db.get(models.Category, t.ai_category_id) if t.ai_category_id else None
        items.append(ReviewQueueItem(
            id=t.id,
            amount=t.amount,
            description=t.description,
            transaction_type=_enum_str(t.transaction_type),
            transaction_date=t.transaction_date,
            account_name=acc.name if acc else None,
            ai_category_id=t.ai_category_id,
            ai_category_name=ai_cat.name if ai_cat else None,
            ai_confidence=t.ai_confidence,
            available_categories=cat_choices,
        ))
    return items


@router.get("/review/count")
def get_review_count(db: Session = Depends(database.get_db)):
    """Badge count: how many transactions need review."""
    count = (
        db.query(func.count(models.Transaction.id))
        .filter(
            models.Transaction.ai_categorized == True,
            models.Transaction.user_confirmed_category == False,
            models.Transaction.transaction_date >= datetime.utcnow() - timedelta(days=90),
        )
        .scalar()
    ) or 0
    return {"pending": count}


@router.patch("/transactions/{tx_id}/category", response_model=MobileTransactionItem)
def update_transaction_category(
    tx_id: int,
    payload: CategoryUpdateRequest,
    db: Session = Depends(database.get_db),
):
    """
    Confirm or correct an AI category suggestion.
    When the user swipes ✓ (confirm) or picks a different category, call this.
    """
    tx = db.get(models.Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    tx.category_id = payload.category_id
    tx.user_confirmed_category = True
    db.commit()

    # Persist learning rule so future similar transactions are auto-categorised correctly
    from app.services.ai_service import save_user_rule
    save_user_rule(tx.description or "", payload.category_id, db)

    db.refresh(tx)
    return _build_transaction_item(tx, db)


@router.post("/review/confirm-all")
def confirm_all_ai_categories(db: Session = Depends(database.get_db)):
    """
    Bulk-accept all pending AI suggestions without individually reviewing them.
    Useful when the user trusts the model but just wants to clear the queue.
    """
    count = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.ai_categorized == True,
            models.Transaction.user_confirmed_category == False,
            models.Transaction.ai_category_id.isnot(None),
        )
        .update({"user_confirmed_category": True}, synchronize_session=False)
    )
    db.commit()
    return {"confirmed": count}
