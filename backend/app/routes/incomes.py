from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app import models, database
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter()

class IncomeCreate(BaseModel):
    source: str
    amount: float
    frequency: str
    recurring_day: Optional[int] = None
    start_date: Optional[datetime] = None

class IncomeResponse(BaseModel):
    id: int
    source: str
    amount: float
    frequency: str
    recurring_day: Optional[int] = None
    start_date: Optional[datetime] = None
    date: datetime

@router.post("/", response_model=IncomeResponse)
def create_income(income: IncomeCreate, db: Session = Depends(database.get_db)):
    db_income = models.Income(
        source=income.source, 
        amount=income.amount, 
        frequency=income.frequency, 
        recurring_day=income.recurring_day,
        start_date=income.start_date
    )
    db.add(db_income)
    db.commit()
    db.refresh(db_income)
    return db_income

@router.get("/", response_model=List[IncomeResponse])
def get_incomes(db: Session = Depends(database.get_db)):
    incomes = db.query(models.Income).all()
    return incomes