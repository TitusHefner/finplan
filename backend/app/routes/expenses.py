from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, database
from pydantic import BaseModel
from typing import List
from datetime import datetime

router = APIRouter()

class ExpenseCreate(BaseModel):
    amount: float
    description: str
    category: str
    type: str = "debit"

class ExpenseResponse(BaseModel):
    id: int
    amount: float
    category: str
    description: str
    type: str
    date: str

@router.post("/", response_model=ExpenseResponse)
def create_expense(expense: ExpenseCreate, db: Session = Depends(database.get_db)):
    db_expense = models.Expense(amount=expense.amount, description=expense.description, category=expense.category, type=expense.type)
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    return ExpenseResponse(
        id=db_expense.id,
        amount=db_expense.amount,
        category=db_expense.category,
        description=db_expense.description,
        type=db_expense.type,
        date=db_expense.date.isoformat()
    )

@router.get("/", response_model=List[ExpenseResponse])
def get_expenses(db: Session = Depends(database.get_db)):
    expenses = db.query(models.Expense).all()
    return [
        ExpenseResponse(
            id=e.id,
            amount=e.amount,
            category=e.category,
            description=e.description,
            type=e.type,
            date=e.date.isoformat()
        ) for e in expenses
    ]