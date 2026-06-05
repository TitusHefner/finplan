from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from app import database, models

router = APIRouter()


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

    class Config:
        from_attributes = True


@router.get("/", response_model=list[AccountResponse])
def list_accounts(db: Session = Depends(database.get_db)):
    return db.query(models.Account).filter(models.Account.is_active == True).all()


@router.post("/", response_model=AccountResponse)
def create_account(payload: AccountCreate, db: Session = Depends(database.get_db)):
    try:
        account_type = models.AccountType(payload.type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid account type: {payload.type}")

    account = models.Account(
        name=payload.name,
        type=account_type,
        balance=payload.balance,
        currency=payload.currency,
        institution=payload.institution,
        account_number=payload.account_number,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(database.get_db)):
    account = db.get(models.Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.patch("/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, payload: AccountCreate, db: Session = Depends(database.get_db)):
    account = db.get(models.Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "type":
            value = models.AccountType(value)
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(database.get_db)):
    account = db.get(models.Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.is_active = False
    db.commit()
    return {"message": "Account deactivated"}
