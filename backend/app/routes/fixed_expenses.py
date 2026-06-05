from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app import models, database
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class FixedExpenseCreate(BaseModel):
    name: str
    amount: float
    frequency: str
    recurring_day: Optional[int] = None

class FixedExpenseResponse(BaseModel):
    id: int
    name: str
    amount: float
    frequency: str
    recurring_day: Optional[int] = None

@router.post("/", response_model=FixedExpenseResponse)
def create_fixed_expense(fixed_expense: FixedExpenseCreate, db: Session = Depends(database.get_db)):
    db_fixed = models.FixedExpense(name=fixed_expense.name, amount=fixed_expense.amount, frequency=fixed_expense.frequency, recurring_day=fixed_expense.recurring_day)
    db.add(db_fixed)
    db.commit()
    db.refresh(db_fixed)
    return FixedExpenseResponse(id=db_fixed.id, name=db_fixed.name, amount=db_fixed.amount, frequency=db_fixed.frequency, recurring_day=db_fixed.recurring_day)

@router.get("/", response_model=List[FixedExpenseResponse])
def get_fixed_expenses(db: Session = Depends(database.get_db)):
    fixed_expenses = db.query(models.FixedExpense).all()
    return [FixedExpenseResponse(id=f.id, name=f.name, amount=f.amount, frequency=f.frequency, recurring_day=f.recurring_day) for f in fixed_expenses]