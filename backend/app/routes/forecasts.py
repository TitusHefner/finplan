from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.services.forecast_service import forecast_expenses, what_if_purchase
from app import models, database
from pydantic import BaseModel

router = APIRouter()

class WhatIfRequest(BaseModel):
    purchase_amount: float
    category: str

@router.get("/forecast")
def get_forecast():
    forecast = forecast_expenses()
    return {"forecast": forecast}

@router.get("/daily-budget")
def get_daily_budget(db: Session = Depends(database.get_db)):
    # Simulate daily budget for 30 days
    incomes = db.query(models.Income).all()
    fixed_expenses = db.query(models.FixedExpense).all()
    expenses = db.query(models.Expense).all()
    
    # Simple simulation: assume monthly income/expenses spread daily
    total_income = sum(i.amount for i in incomes if i.frequency == 'monthly')
    total_fixed = sum(f.amount for f in fixed_expenses if f.frequency == 'monthly')
    daily_spend = sum(e.amount for e in expenses) / 30  # rough daily
    
    daily_budget = []
    balance = 0
    for day in range(1, 31):
        balance += total_income / 30 - total_fixed / 30 - daily_spend
        daily_budget.append({"day": day, "spending": daily_spend, "balance": balance})
    
    return {"daily_budget": daily_budget}