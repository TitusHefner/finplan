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

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
