from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app import models, database
from pydantic import BaseModel
from typing import List

router = APIRouter()

class BudgetCreate(BaseModel):
    category: str
    amount: float
    period: str

class BudgetResponse(BaseModel):
    id: int
    category: str
    amount: float
    period: str

@router.post("/", response_model=BudgetResponse)
def create_budget(budget: BudgetCreate, db: Session = Depends(database.get_db)):
    db_budget = models.Budget(category=budget.category, amount=budget.amount, period=budget.period)
    db.add(db_budget)
    db.commit()
    db.refresh(db_budget)
    return BudgetResponse(id=db_budget.id, category=db_budget.category, amount=db_budget.amount, period=db_budget.period)

@router.get("/", response_model=List[BudgetResponse])
def get_budgets(db: Session = Depends(database.get_db)):
    budgets = db.query(models.Budget).all()
    return [BudgetResponse(id=b.id, category=b.category, amount=b.amount, period=b.period) for b in budgets]