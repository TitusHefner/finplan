"""
Goals & Financial Planning routes.

Endpoints:
  GET    /api/goals/                          – list all goals
  POST   /api/goals/                          – create a goal
  PATCH  /api/goals/{id}                      – update a goal
  DELETE /api/goals/{id}                      – delete a goal
  POST   /api/goals/{id}/contribute           – log a manual contribution
  GET    /api/goals/{id}/contributions        – list contributions for a goal
  POST   /api/goals/{id}/sync-plaid           – pull current Plaid balance into current_amount for debt goals

  GET    /api/goals/manual-debts/             – list manual debt accounts
  POST   /api/goals/manual-debts/             – create a manual debt account
  PATCH  /api/goals/manual-debts/{id}         – update a manual debt account
  DELETE /api/goals/manual-debts/{id}         – delete a manual debt account
"""

from __future__ import annotations

from datetime import datetime, timedelta
from collections import defaultdict
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import database, models

router = APIRouter()


# ── Pydantic schemas ───────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    name: str
    goal_type: str  # savings | debt_payoff | emergency_fund | investment | purchase
    target_amount: float
    current_amount: float = 0.0
    target_date: Optional[str] = None   # ISO date string, e.g. "2027-01-01"
    description: Optional[str] = None
    priority: int = 3                   # 1 (low) – 5 (high)
    plaid_account_id: Optional[str] = None


class GoalUpdate(BaseModel):
    name: Optional[str] = None
    goal_type: Optional[str] = None
    target_amount: Optional[float] = None
    current_amount: Optional[float] = None
    target_date: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    is_completed: Optional[bool] = None
    plaid_account_id: Optional[str] = None


class ContributionCreate(BaseModel):
    amount: float
    notes: Optional[str] = None
    contribution_date: Optional[str] = None  # ISO date, defaults to now


# ── Helpers ────────────────────────────────────────────────────────────────

def _goal_to_dict(goal: models.Goal) -> dict:
    total_contributions = sum(c.amount for c in goal.contributions)
    pct = 0.0
    if goal.target_amount and goal.target_amount > 0:
        pct = round(min((goal.current_amount / goal.target_amount) * 100, 100), 1)

    # Days remaining
    days_remaining = None
    if goal.target_date:
        delta = goal.target_date - datetime.utcnow()
        days_remaining = max(delta.days, 0)

    # Monthly amount needed to hit goal on time
    monthly_needed = None
    if goal.target_date and not goal.is_completed:
        remaining = goal.target_amount - goal.current_amount
        if days_remaining and days_remaining > 0:
            months_left = max(days_remaining / 30.44, 0.5)
            monthly_needed = round(remaining / months_left, 2)

    return {
        "id": goal.id,
        "name": goal.name,
        "goal_type": goal.goal_type.value if goal.goal_type else None,
        "target_amount": goal.target_amount,
        "current_amount": goal.current_amount,
        "target_date": goal.target_date.isoformat() if goal.target_date else None,
        "description": goal.description,
        "priority": goal.priority,
        "is_completed": goal.is_completed,
        "completed_at": goal.completed_at.isoformat() if goal.completed_at else None,
        "plaid_account_id": goal.plaid_account_id,
        "total_contributions": round(total_contributions, 2),
        "progress_pct": pct,
        "days_remaining": days_remaining,
        "monthly_needed": monthly_needed,
        "created_at": goal.created_at.isoformat(),
    }


def _get_plaid_balance_for_account(plaid_account_id: str) -> Optional[float]:
    """Fetch the current Plaid balance for a given account_id. Returns None on any failure."""
    try:
        import os
        from dotenv import load_dotenv
        load_dotenv()

        import plaid
        from plaid.api import plaid_api
        from plaid.configuration import Configuration
        from plaid.api_client import ApiClient
        from plaid.model.accounts_get_request import AccountsGetRequest
        from app.database import SessionLocal

        client_id = os.getenv("PLAID_CLIENT_ID")
        secret = os.getenv("PLAID_SECRET")
        env_name = os.getenv("PLAID_ENV", "sandbox").lower()
        if not client_id or not secret:
            return None

        env_map = {
            "sandbox":     plaid.Environment.Sandbox,
            "development": plaid.Environment.Sandbox,
            "production":  plaid.Environment.Production,
        }
        configuration = Configuration(
            host=env_map.get(env_name, plaid.Environment.Sandbox),
            api_key={"clientId": client_id, "secret": secret},
        )
        client = plaid_api.PlaidApi(ApiClient(configuration))

        db = SessionLocal()
        try:
            items = db.query(models.PlaidItem).all()
            for item in items:
                resp = client.accounts_get(AccountsGetRequest(access_token=item.access_token))
                for acct in resp["accounts"]:
                    if acct.get("account_id") == plaid_account_id:
                        return acct.get("balances", {}).get("current")
        finally:
            db.close()
    except Exception:
        pass
    return None


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_goals(db: Session = Depends(database.get_db)):
    goals = db.query(models.Goal).order_by(models.Goal.priority.desc(), models.Goal.created_at).all()
    return [_goal_to_dict(g) for g in goals]


@router.post("/")
def create_goal(payload: GoalCreate, db: Session = Depends(database.get_db)):
    try:
        goal_type = models.GoalType(payload.goal_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid goal_type: {payload.goal_type}")

    target_date = None
    if payload.target_date:
        try:
            target_date = datetime.fromisoformat(payload.target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid target_date format, use ISO 8601")

    goal = models.Goal(
        name=payload.name,
        goal_type=goal_type,
        target_amount=payload.target_amount,
        current_amount=payload.current_amount,
        target_date=target_date,
        description=payload.description,
        priority=max(1, min(5, payload.priority)),
        plaid_account_id=payload.plaid_account_id,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.patch("/{goal_id}")
def update_goal(goal_id: int, payload: GoalUpdate, db: Session = Depends(database.get_db)):
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    data = payload.model_dump(exclude_unset=True)

    if "goal_type" in data:
        try:
            data["goal_type"] = models.GoalType(data["goal_type"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid goal_type: {data['goal_type']}")

    if "target_date" in data and data["target_date"]:
        try:
            data["target_date"] = datetime.fromisoformat(data["target_date"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid target_date format")

    if "is_completed" in data and data["is_completed"] and not goal.is_completed:
        data["completed_at"] = datetime.utcnow()

    if "priority" in data:
        data["priority"] = max(1, min(5, data["priority"]))

    for field, value in data.items():
        setattr(goal, field, value)

    goal.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.delete("/{goal_id}")
def delete_goal(goal_id: int, db: Session = Depends(database.get_db)):
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(goal)
    db.commit()
    return {"message": "Goal deleted"}


@router.get("/{goal_id}/contributions")
def list_contributions(goal_id: int, db: Session = Depends(database.get_db)):
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return [
        {
            "id": c.id,
            "amount": c.amount,
            "notes": c.notes,
            "contribution_date": c.contribution_date.isoformat(),
        }
        for c in sorted(goal.contributions, key=lambda c: c.contribution_date, reverse=True)
    ]


@router.post("/{goal_id}/contribute")
def add_contribution(goal_id: int, payload: ContributionCreate, db: Session = Depends(database.get_db)):
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    contrib_date = datetime.utcnow()
    if payload.contribution_date:
        try:
            contrib_date = datetime.fromisoformat(payload.contribution_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid contribution_date format")

    contribution = models.GoalContribution(
        goal_id=goal.id,
        amount=payload.amount,
        notes=payload.notes,
        contribution_date=contrib_date,
    )
    db.add(contribution)

    # Update goal's current_amount
    goal.current_amount = round(goal.current_amount + payload.amount, 2)
    if goal.current_amount >= goal.target_amount and not goal.is_completed:
        goal.is_completed = True
        goal.completed_at = datetime.utcnow()

    goal.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.post("/{goal_id}/sync-plaid")
def sync_plaid_balance(goal_id: int, db: Session = Depends(database.get_db)):
    """
    For debt_payoff goals linked to a Plaid account, pull the current balance
    and set current_amount = target_amount - outstanding_debt
    so progress reflects how much debt has been paid off.
    """
    goal = db.get(models.Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if not goal.plaid_account_id:
        raise HTTPException(status_code=400, detail="Goal is not linked to a Plaid account")

    balance = _get_plaid_balance_for_account(goal.plaid_account_id)
    if balance is None:
        raise HTTPException(status_code=502, detail="Could not fetch Plaid balance")

    # For debt goals: progress = how much has been paid off
    # current_amount = original_debt - current_balance = target_amount - balance
    goal.current_amount = round(max(goal.target_amount - balance, 0), 2)
    if goal.current_amount >= goal.target_amount:
        goal.is_completed = True
        goal.completed_at = datetime.utcnow()

    goal.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(goal)
    return {**_goal_to_dict(goal), "synced_balance": balance}


# ── Manual Debt Accounts ───────────────────────────────────────────────────

DEBT_TYPE_LABELS = {
    "credit_card":    "Credit Card",
    "student_loan":   "Student Loan",
    "mortgage":       "Mortgage",
    "personal_loan":  "Personal Loan",
    "auto":           "Auto Loan",
    "other":          "Other",
}


class ManualDebtCreate(BaseModel):
    name: str
    debt_type: str
    institution_name: Optional[str] = None
    current_balance: float
    credit_limit: Optional[float] = None
    interest_rate: Optional[float] = None
    minimum_payment: Optional[float] = None
    next_payment_due_date: Optional[str] = None
    notes: Optional[str] = None


class ManualDebtUpdate(BaseModel):
    name: Optional[str] = None
    debt_type: Optional[str] = None
    institution_name: Optional[str] = None
    current_balance: Optional[float] = None
    credit_limit: Optional[float] = None
    interest_rate: Optional[float] = None
    minimum_payment: Optional[float] = None
    next_payment_due_date: Optional[str] = None
    notes: Optional[str] = None


class StrategyDebtInput(BaseModel):
    name: str
    debt_type: str
    current_balance: float
    interest_rate: float = 0.0
    minimum_payment: Optional[float] = None
    institution_name: Optional[str] = None
    source: Optional[str] = None
    next_payment_due_date: Optional[str] = None


class DebtStrategyRequest(BaseModel):
    debts: list[StrategyDebtInput] = Field(default_factory=list)
    extra_payment_budget: float = 0.0
    lookback_days: int = 120
    fixed_credit_card_name: Optional[str] = None
    fixed_credit_card_autopay: float = 0.0
    fixed_credit_card_extra: float = 0.0
    student_strategy: str = "snowball"
    ignore_estimated_student_minimums: bool = False
    graduation_date: Optional[str] = None
    grace_period_months: int = 6
    student_extra_override: Optional[float] = None


def _debt_to_dict(d: models.ManualDebtAccount) -> dict:
    pct = None
    if d.credit_limit and d.credit_limit > 0:
        pct = round((d.current_balance / d.credit_limit) * 100, 1)
    return {
        "id": d.id,
        "account_id": f"manual-{d.id}",   # synthetic id so frontend can treat it uniformly
        "name": d.name,
        "debt_type": d.debt_type,
        "subtype": DEBT_TYPE_LABELS.get(d.debt_type, d.debt_type),
        "institution_name": d.institution_name or "",
        "current_balance": d.current_balance,
        "credit_limit": d.credit_limit,
        "interest_rate": d.interest_rate,
        "purchase_apr": d.interest_rate,   # alias so frontend card renders it
        "minimum_payment_amount": d.minimum_payment,
        "next_payment_due_date": d.next_payment_due_date or "",
        "notes": d.notes,
        "utilization_pct": pct,
        "is_manual": True,
        "is_overdue": False,
        "kind": d.debt_type,
        "created_at": d.created_at.isoformat(),
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


_DEBT_WORD_STOPLIST = {
    "loan", "loans", "direct", "subsidized", "unsubsidized", "payment",
    "pay", "bank", "card", "credit", "account", "the", "and", "for",
}


def _estimate_min_payment(balance: float, debt_type: str, provided_min: Optional[float]) -> float:
    if provided_min is not None and provided_min > 0:
        return float(provided_min)
    if debt_type == "credit_card":
        return max(35.0, balance * 0.025)
    if debt_type == "student_loan":
        return max(50.0, balance * 0.012)
    return max(40.0, balance * 0.02)


def _keyword_tokens(text: Optional[str]) -> list[str]:
    if not text:
        return []
    toks = [t.lower() for t in re.findall(r"[a-zA-Z0-9]+", text)]
    return [t for t in toks if len(t) >= 4 and t not in _DEBT_WORD_STOPLIST]


def _detect_manual_debt_payments(
    db: Session,
    manual_debts: list[models.ManualDebtAccount],
    lookback_days: int,
) -> tuple[list[dict], set[int]]:
    """
    Detect likely payments to manual debt accounts by matching transaction
    descriptions against debt/account keywords and amount patterns.
    Returns (per-debt signals, matched transaction ids).
    """
    if not manual_debts:
        return [], set()

    since = datetime.utcnow() - timedelta(days=max(30, min(lookback_days, 365)))
    txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.transaction_date >= since,
            models.Transaction.transaction_type.in_([
                models.TransactionType.EXPENSE,
                models.TransactionType.TRANSFER,
            ]),
        )
        .all()
    )

    debt_rows = []
    for d in manual_debts:
        debt_rows.append({
            "debt": d,
            "name_tokens": _keyword_tokens(d.name),
            "inst_tokens": _keyword_tokens(d.institution_name),
            "min_guess": _estimate_min_payment(abs(d.current_balance or 0.0), d.debt_type or "other", d.minimum_payment),
        })

    matched_by_debt: dict[int, list[dict]] = defaultdict(list)
    matched_ids: set[int] = set()

    for tx in txs:
        desc = (tx.description or "").lower()
        if not desc:
            continue
        amount = abs(float(tx.amount or 0.0))

        best = None
        best_score = 0.0
        for row in debt_rows:
            score = 0.0
            if row["inst_tokens"] and any(tok in desc for tok in row["inst_tokens"]):
                score += 0.7
            if row["name_tokens"] and any(tok in desc for tok in row["name_tokens"]):
                score += 0.35
            mg = row["min_guess"]
            if mg > 0 and (0.45 * mg) <= amount <= (2.5 * mg):
                score += 0.1

            if score > best_score:
                best_score = score
                best = row

        if best and best_score >= 0.7:
            d = best["debt"]
            matched_by_debt[d.id].append({
                "id": tx.id,
                "date": tx.transaction_date,
                "description": tx.description,
                "amount": amount,
                "confidence": round(min(best_score, 1.0), 2),
            })
            matched_ids.add(tx.id)

    debt_signals: list[dict] = []
    for d in manual_debts:
        events = sorted(matched_by_debt.get(d.id, []), key=lambda x: x["date"], reverse=True)
        monthly: dict[str, float] = defaultdict(float)
        for ev in events:
            monthly[ev["date"].strftime("%Y-%m")] += ev["amount"]

        month_keys = sorted(monthly.keys(), reverse=True)[:3]
        avg_recent = sum(monthly[k] for k in month_keys) / len(month_keys) if month_keys else 0.0
        last_date = events[0]["date"] if events else None
        days_since = (datetime.utcnow() - last_date).days if last_date else None
        min_guess = _estimate_min_payment(abs(d.current_balance or 0.0), d.debt_type or "other", d.minimum_payment)

        status = "no_signal"
        if last_date:
            if days_since is not None and days_since <= 45 and avg_recent >= (0.8 * min_guess):
                status = "on_track"
            elif avg_recent > 0:
                status = "partial_or_stale"
            else:
                status = "at_risk"

        debt_signals.append({
            "manual_debt_id": d.id,
            "name": d.name,
            "institution_name": d.institution_name,
            "estimated_minimum": round(min_guess, 2),
            "last_detected_payment_date": last_date.isoformat() if last_date else None,
            "days_since_last_payment": days_since,
            "avg_detected_monthly_payment": round(avg_recent, 2),
            "detected_payments_count": len(events),
            "status": status,
            "sample_events": [
                {
                    "id": ev["id"],
                    "date": ev["date"].isoformat(),
                    "description": ev["description"],
                    "amount": round(ev["amount"], 2),
                    "confidence": ev["confidence"],
                }
                for ev in events[:5]
            ],
        })

    return debt_signals, matched_ids


def _simulate_strategy(debts: list[dict], strategy: str, monthly_payment_budget: float) -> dict:
    rows = [
        {
            "name": d["name"],
            "debt_type": d["debt_type"],
            "remaining": float(max(d["current_balance"], 0.0)),
            "apr": float(max(d.get("interest_rate", 0.0), 0.0)),
            "minimum": float(max(d.get("minimum_payment", 0.0), 0.0)),
        }
        for d in debts
        if d["current_balance"] > 0
    ]
    if not rows:
        return {
            "strategy": strategy,
            "months_to_debt_free": 0,
            "total_interest_paid": 0.0,
            "total_paid": 0.0,
            "payoff_order": [],
            "timeline": [{"month": 0, "balance": 0.0}],
        }

    timeline = []
    payoff_order = []
    total_interest = 0.0
    total_paid = 0.0
    month = 0
    max_months = 600

    base_minimums = sum(r["minimum"] for r in rows)
    budget = max(monthly_payment_budget, base_minimums)

    def _priority(r):
        if strategy == "snowball":
            return (r["remaining"], -r["apr"])
        if strategy == "adaptive":
            return (-((0.65 * r["apr"]) + (35.0 / max(r["remaining"], 35.0))), -r["remaining"])
        # avalanche
        return (-r["apr"], -r["remaining"])

    while month <= max_months:
        total_balance = sum(r["remaining"] for r in rows)
        timeline.append({"month": month, "balance": round(max(total_balance, 0.0), 2)})
        if total_balance <= 0.01:
            break

        # Interest accrual
        for r in rows:
            if r["remaining"] <= 0:
                continue
            interest = r["remaining"] * (r["apr"] / 1200.0)
            r["remaining"] += interest
            total_interest += interest

        # Minimum payments first
        pay_pool = budget
        for r in rows:
            if r["remaining"] <= 0 or pay_pool <= 0:
                continue
            pay = min(r["minimum"], r["remaining"], pay_pool)
            r["remaining"] -= pay
            total_paid += pay
            pay_pool -= pay

        # Extra payments according to strategy priority
        for r in sorted(rows, key=_priority):
            if pay_pool <= 0 or r["remaining"] <= 0:
                continue
            pay = min(r["remaining"], pay_pool)
            r["remaining"] -= pay
            total_paid += pay
            pay_pool -= pay

        # Record payoff events
        for r in rows:
            if r["remaining"] <= 0.01 and not any(p["name"] == r["name"] for p in payoff_order):
                payoff_order.append({"name": r["name"], "month": month + 1})

        month += 1

    return {
        "strategy": strategy,
        "months_to_debt_free": month,
        "total_interest_paid": round(total_interest, 2),
        "total_paid": round(total_paid, 2),
        "payoff_order": payoff_order,
        "timeline": timeline,
    }


def _simulate_fixed_card_plus_student_strategy(
    debts: list[dict],
    monthly_income: float,
    monthly_non_debt_expenses: float,
    fixed_card_name: Optional[str],
    fixed_card_autopay: float,
    fixed_card_extra: float,
    student_strategy: str,
    graduation_date: Optional[str],
    grace_period_months: int,
    student_extra_override: Optional[float] = None,
) -> dict:
    """
    Simulate a custom plan:
    - Pay a fixed amount to one named credit card each month (autopay + extra).
    - Keep all other listed minimum payments.
    - Direct remaining discretionary cash to student loans in chosen order.
    """
    rows = [
        {
            "id": idx,
            "name": d["name"],
            "debt_type": d["debt_type"],
            "remaining": float(max(d["current_balance"], 0.0)),
            "apr": float(max(d.get("interest_rate", 0.0), 0.0)),
            "minimum": float(max(d.get("minimum_payment", 0.0), 0.0)),
            "estimated_minimum": float(max(d.get("estimated_minimum", d.get("minimum_payment", 0.0)), 0.0)),
            "institution_name": d.get("institution_name") or "",
            "next_payment_due_date": d.get("next_payment_due_date"),
        }
        for idx, d in enumerate(debts)
        if d["current_balance"] > 0
    ]
    if not rows:
        return {
            "strategy": "fixed_card_plus_student",
            "fixed_card": None,
            "fixed_card_monthly_payment": 0.0,
            "recommended_student_extra_payment": 0.0,
            "student_extra_payment_used": 0.0,
            "student_extra_is_manual_override": False,
            "monthly_discretionary_cashflow_estimate": 0.0,
            "months_to_debt_free": 0,
            "total_interest_paid": 0.0,
            "total_paid": 0.0,
            "student_payoff_order": [],
            "timeline": [{"month": 0, "balance": 0.0}],
            "per_account_timelines": [],
        }

    fixed_name_norm = (fixed_card_name or "").strip().lower()
    fixed_card_idx = None
    if fixed_name_norm:
        for i, r in enumerate(rows):
            if r["debt_type"] != "credit_card":
                continue
            haystack = f"{r['name']} {r['institution_name']}".lower()
            if fixed_name_norm in haystack:
                fixed_card_idx = i
                break

    if fixed_card_idx is None:
        candidates = [
            (i, r)
            for i, r in enumerate(rows)
            if r["debt_type"] == "credit_card" and r["remaining"] > 0
        ]
        if candidates:
            fixed_card_idx = sorted(candidates, key=lambda x: x[1]["apr"], reverse=True)[0][0]

    fixed_payment = max(float(fixed_card_autopay or 0.0), 0.0) + max(float(fixed_card_extra or 0.0), 0.0)

    today = datetime.utcnow().date()

    def _safe_parse_date(s: Optional[str]) -> Optional[datetime.date]:
        if not s:
            return None
        try:
            return datetime.fromisoformat(str(s).split("T")[0]).date()
        except ValueError:
            return None

    grad_date = _safe_parse_date(graduation_date)
    fallback_grace_end = None
    if grad_date is not None:
        fallback_grace_end = grad_date + timedelta(days=max(grace_period_months, 0) * 30)

    def _grace_end_date_for_row(r: dict) -> Optional[datetime.date]:
        next_due = _safe_parse_date(r.get("next_payment_due_date"))
        if next_due is not None and next_due > today:
            return next_due
        return fallback_grace_end

    for r in rows:
        r["grace_end_date"] = _grace_end_date_for_row(r)
        r["in_grace_now"] = bool(
            r["debt_type"] == "student_loan"
            and r["grace_end_date"] is not None
            and today < r["grace_end_date"]
        )

    per_account_timelines = {
        str(r["id"]): [{"month": 0, "balance": round(r["remaining"], 2)}] for r in rows
    }

    def _student_key(r: dict) -> tuple[float, float]:
        if student_strategy == "avalanche":
            return (-r["apr"], -r["remaining"])
        # default snowball
        return (r["remaining"], -r["apr"])

    student_attack_order = [
        {
            "name": r["name"],
            "institution_name": r["institution_name"],
            "apr": round(r["apr"], 4),
            "current_balance": round(r["remaining"], 2),
            "grace_end_date": r["grace_end_date"].isoformat() if r["grace_end_date"] else None,
            "in_grace_now": r["in_grace_now"],
        }
        for r in sorted(
            [x for x in rows if x["debt_type"] == "student_loan" and x["remaining"] > 0],
            key=_student_key,
        )
    ]

    def _student_required_minimum(r: dict, month_num: int) -> float:
        if r["debt_type"] != "student_loan":
            return r["minimum"]
        grace_end = r.get("grace_end_date")
        if grace_end is not None:
            month_date = (datetime.utcnow() + timedelta(days=month_num * 30)).date()
            if month_date < grace_end:
                return 0.0
        return r["minimum"] if r["minimum"] > 0 else r["estimated_minimum"]

    non_student_required = 0.0
    for i, r in enumerate(rows):
        if fixed_card_idx is not None and i == fixed_card_idx:
            continue
        if r["debt_type"] != "student_loan":
            non_student_required += r["minimum"]

    student_required_now = sum(
        _student_required_minimum(r, 0) for r in rows if r["debt_type"] == "student_loan" and r["remaining"] > 0
    )
    monthly_discretionary = max(
        float(monthly_income) - float(monthly_non_debt_expenses) - non_student_required - student_required_now - fixed_payment,
        0.0,
    )
    recommended_student_extra = monthly_discretionary
    student_extra_used = (
        max(float(student_extra_override), 0.0)
        if student_extra_override is not None
        else recommended_student_extra
    )
    student_extra_is_override = student_extra_override is not None

    timeline = []
    student_payoff_order = []
    total_interest = 0.0
    total_paid = 0.0
    month = 0
    max_months = 600

    while month <= max_months:
        total_balance = sum(r["remaining"] for r in rows)
        timeline.append({"month": month, "balance": round(max(total_balance, 0.0), 2)})
        if total_balance <= 0.01:
            break

        for r in rows:
            if r["remaining"] <= 0:
                continue
            interest = r["remaining"] * (r["apr"] / 1200.0)
            r["remaining"] += interest
            total_interest += interest

        paid_by_id: dict[int, float] = defaultdict(float)

        if fixed_card_idx is not None:
            fixed_row = rows[fixed_card_idx]
            if fixed_row["remaining"] > 0:
                pay = min(fixed_payment, fixed_row["remaining"])
                fixed_row["remaining"] -= pay
                total_paid += pay
                paid_by_id[fixed_row["id"]] += pay

        for i, r in enumerate(rows):
            if r["remaining"] <= 0:
                continue
            if fixed_card_idx is not None and i == fixed_card_idx:
                continue
            required_min = _student_required_minimum(r, month)
            pay = min(required_min, r["remaining"])
            r["remaining"] -= pay
            total_paid += pay
            paid_by_id[r["id"]] += pay

        student_targets = sorted(
            [r for r in rows if r["debt_type"] == "student_loan" and r["remaining"] > 0],
            key=_student_key,
        )
        if student_extra_used > 0 and student_targets:
            # Apply "minimum + extra debt payment amount" to the current attack loan first.
            current_target = student_targets[0]
            target_min_for_month = _student_required_minimum(current_target, month)
            target_effective_min = max(target_min_for_month, current_target["estimated_minimum"])
            min_top_up = max(target_effective_min - paid_by_id[current_target["id"]], 0.0)
            pay_min_top_up = min(current_target["remaining"], min_top_up, student_extra_used)
            if pay_min_top_up > 0:
                current_target["remaining"] -= pay_min_top_up
                total_paid += pay_min_top_up
                paid_by_id[current_target["id"]] += pay_min_top_up

            student_extra_pool = max(student_extra_used - pay_min_top_up, 0.0)
            while student_extra_pool > 0.01:
                student_targets = sorted(
                    [r for r in rows if r["debt_type"] == "student_loan" and r["remaining"] > 0],
                    key=_student_key,
                )
                if not student_targets:
                    break
                target = student_targets[0]
                pay = min(target["remaining"], student_extra_pool)
                target["remaining"] -= pay
                total_paid += pay
                student_extra_pool -= pay
                paid_by_id[target["id"]] += pay

        remainder_pool = max(monthly_discretionary - student_extra_used, 0.0)
        if remainder_pool > 0.01:
            remainder_targets = [r for r in rows if r["remaining"] > 0]
            for r in sorted(remainder_targets, key=lambda x: (-x["apr"], -x["remaining"])):
                if remainder_pool <= 0.01:
                    break
                pay = min(r["remaining"], remainder_pool)
                r["remaining"] -= pay
                total_paid += pay
                remainder_pool -= pay
                paid_by_id[r["id"]] += pay

        for r in rows:
            if r["remaining"] <= 0.01 and r["debt_type"] == "student_loan":
                if not any(p["name"] == r["name"] for p in student_payoff_order):
                    student_payoff_order.append({"name": r["name"], "month": month + 1})
            per_account_timelines[str(r["id"])].append({"month": month + 1, "balance": round(max(r["remaining"], 0.0), 2)})

        month += 1

    fixed_card_name_out = rows[fixed_card_idx]["name"] if fixed_card_idx is not None else None
    return {
        "strategy": "fixed_card_plus_student",
        "fixed_card": fixed_card_name_out,
        "fixed_card_monthly_payment": round(fixed_payment, 2),
        "recommended_student_extra_payment": round(recommended_student_extra, 2),
        "student_extra_payment_used": round(student_extra_used, 2),
        "student_extra_is_manual_override": student_extra_is_override,
        "monthly_discretionary_cashflow_estimate": round(monthly_discretionary, 2),
        "grace_period": {
            "graduation_date": graduation_date,
            "grace_period_months": grace_period_months,
            "assumed_grace_end_date": fallback_grace_end.isoformat() if fallback_grace_end else None,
        },
        "student_strategy": student_strategy,
        "months_to_debt_free": month,
        "total_interest_paid": round(total_interest, 2),
        "total_paid": round(total_paid, 2),
        "student_attack_order": student_attack_order,
        "student_payoff_order": student_payoff_order,
        "timeline": timeline,
        "per_account_timelines": [
            {
                "id": r["id"],
                "name": r["name"],
                "institution_name": r["institution_name"],
                "debt_type": r["debt_type"],
                "apr": round(r["apr"], 4),
                "grace_end_date": r["grace_end_date"].isoformat() if r["grace_end_date"] else None,
                "in_grace_now": r["in_grace_now"],
                "timeline": per_account_timelines[str(r["id"])],
            }
            for r in rows
        ],
    }


@router.post("/debt-strategy")
def build_debt_strategy(payload: DebtStrategyRequest, db: Session = Depends(database.get_db)):
    """
    Build debt-payoff strategy scenarios using user cashflow context and debt mix.
    Also detects likely manual debt payments from transaction history for debts not
    linked through Plaid.
    """
    manual_debts = db.query(models.ManualDebtAccount).all()
    manual_signals, matched_tx_ids = _detect_manual_debt_payments(db, manual_debts, payload.lookback_days)

    # Debt universe: request payload (frontend can include Plaid + manual) with
    # fallback to server-side manual debts.
    if payload.debts:
        debts = [
            {
                "name": d.name,
                "debt_type": d.debt_type,
                "current_balance": abs(float(d.current_balance or 0.0)),
                "interest_rate": float(d.interest_rate or 0.0),
                "estimated_minimum": _estimate_min_payment(abs(float(d.current_balance or 0.0)), d.debt_type, d.minimum_payment),
                "minimum_payment": (
                    0.0
                    if payload.ignore_estimated_student_minimums
                    and d.debt_type == "student_loan"
                    and (d.minimum_payment is None or float(d.minimum_payment) <= 0)
                    else _estimate_min_payment(abs(float(d.current_balance or 0.0)), d.debt_type, d.minimum_payment)
                ),
                "institution_name": d.institution_name,
                "source": d.source,
                "next_payment_due_date": d.next_payment_due_date,
            }
            for d in payload.debts
        ]
    else:
        debts = [
            {
                "name": d.name,
                "debt_type": d.debt_type,
                "current_balance": abs(float(d.current_balance or 0.0)),
                "interest_rate": float(d.interest_rate or 0.0),
                "estimated_minimum": _estimate_min_payment(abs(float(d.current_balance or 0.0)), d.debt_type, d.minimum_payment),
                "minimum_payment": (
                    0.0
                    if payload.ignore_estimated_student_minimums
                    and d.debt_type == "student_loan"
                    and (d.minimum_payment is None or float(d.minimum_payment) <= 0)
                    else _estimate_min_payment(abs(float(d.current_balance or 0.0)), d.debt_type, d.minimum_payment)
                ),
                "institution_name": d.institution_name,
                "source": "manual",
                "next_payment_due_date": d.next_payment_due_date,
            }
            for d in manual_debts
        ]

    # Cashflow context from transaction history, excluding detected manual debt payments
    # to avoid double counting debt service as lifestyle spending.
    since = datetime.utcnow() - timedelta(days=max(60, min(payload.lookback_days, 365)))
    txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.transaction_date >= since,
            models.Transaction.transaction_type.in_([
                models.TransactionType.INCOME,
                models.TransactionType.EXPENSE,
            ]),
        )
        .all()
    )
    income_total = sum(abs(float(t.amount or 0.0)) for t in txs if t.transaction_type == models.TransactionType.INCOME)
    non_debt_expense_total = sum(
        abs(float(t.amount or 0.0))
        for t in txs
        if t.transaction_type == models.TransactionType.EXPENSE and t.id not in matched_tx_ids
    )

    months = max(payload.lookback_days / 30.0, 2.0)
    monthly_income = income_total / months
    monthly_non_debt_expenses = non_debt_expense_total / months

    baseline_minimums = sum(float(d["minimum_payment"]) for d in debts if d["current_balance"] > 0)
    weighted_apr = (
        sum(float(d["current_balance"]) * float(d["interest_rate"]) for d in debts)
        / sum(float(d["current_balance"]) for d in debts)
        if sum(float(d["current_balance"]) for d in debts) > 0
        else 0.0
    )

    available_extra = max(monthly_income - monthly_non_debt_expenses - baseline_minimums, 0.0)
    budget = baseline_minimums + max(available_extra, payload.extra_payment_budget)
    dti = (baseline_minimums / monthly_income * 100.0) if monthly_income > 0 else 0.0

    scenarios = [
        _simulate_strategy(debts, "avalanche", budget),
        _simulate_strategy(debts, "snowball", budget),
        _simulate_strategy(debts, "adaptive", budget),
    ]

    custom_plan = _simulate_fixed_card_plus_student_strategy(
        debts=debts,
        monthly_income=monthly_income,
        monthly_non_debt_expenses=monthly_non_debt_expenses,
        fixed_card_name=payload.fixed_credit_card_name,
        fixed_card_autopay=payload.fixed_credit_card_autopay,
        fixed_card_extra=payload.fixed_credit_card_extra,
        student_strategy=(payload.student_strategy or "snowball").lower(),
        graduation_date=payload.graduation_date,
        grace_period_months=max(0, int(payload.grace_period_months)),
        student_extra_override=payload.student_extra_override,
    )

    rec = "adaptive"
    rationale = "Adaptive balances interest efficiency and quick-win cashflow relief."
    if weighted_apr >= 8.0:
        rec = "avalanche"
        rationale = "High weighted APR suggests prioritizing interest minimization."
    elif dti >= 40.0 or available_extra < 100:
        rec = "snowball"
        rationale = "Tight debt-service ratio favors fast balance closures to free minimum payments."

    return {
        "context": {
            "lookback_days": payload.lookback_days,
            "monthly_income_estimate": round(monthly_income, 2),
            "monthly_non_debt_expenses_estimate": round(monthly_non_debt_expenses, 2),
            "baseline_minimum_payments": round(baseline_minimums, 2),
            "available_extra_payment_estimate": round(available_extra, 2),
            "monthly_budget_used_for_strategy": round(budget, 2),
            "debt_to_income_ratio_estimate": round(dti, 2),
            "weighted_apr": round(weighted_apr, 2),
        },
        "manual_payment_signals": manual_signals,
        "strategies": scenarios,
        "custom_plan": custom_plan,
        "recommended_strategy": rec,
        "rationale": rationale,
    }


@router.get("/manual-debts/")
def list_manual_debts(db: Session = Depends(database.get_db)):
    debts = db.query(models.ManualDebtAccount).order_by(models.ManualDebtAccount.created_at).all()
    return [_debt_to_dict(d) for d in debts]


@router.post("/manual-debts/")
def create_manual_debt(payload: ManualDebtCreate, db: Session = Depends(database.get_db)):
    if payload.debt_type not in DEBT_TYPE_LABELS:
        raise HTTPException(status_code=400, detail=f"Invalid debt_type. Choose from: {', '.join(DEBT_TYPE_LABELS)}")
    debt = models.ManualDebtAccount(**payload.model_dump())
    db.add(debt)
    db.commit()
    db.refresh(debt)
    return _debt_to_dict(debt)


@router.patch("/manual-debts/{debt_id}")
def update_manual_debt(debt_id: int, payload: ManualDebtUpdate, db: Session = Depends(database.get_db)):
    debt = db.get(models.ManualDebtAccount, debt_id)
    if not debt:
        raise HTTPException(status_code=404, detail="Manual debt account not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(debt, field, value)
    debt.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(debt)
    return _debt_to_dict(debt)


@router.delete("/manual-debts/{debt_id}")
def delete_manual_debt(debt_id: int, db: Session = Depends(database.get_db)):
    debt = db.get(models.ManualDebtAccount, debt_id)
    if not debt:
        raise HTTPException(status_code=404, detail="Manual debt account not found")
    db.delete(debt)
    db.commit()
    return {"message": "Deleted"}
