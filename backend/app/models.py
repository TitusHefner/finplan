from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, Enum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

Base = declarative_base()

# Enums
class TransactionType(enum.Enum):
    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"

class BudgetType(enum.Enum):
    MONTHLY = "monthly"
    WEEKLY = "weekly"
    YEARLY = "yearly"

class GoalType(enum.Enum):
    SAVINGS = "savings"
    DEBT_PAYOFF = "debt_payoff"
    EMERGENCY_FUND = "emergency_fund"
    INVESTMENT = "investment"
    PURCHASE = "purchase"

class AccountType(enum.Enum):
    CHECKING = "checking"
    SAVINGS = "savings"
    CREDIT_CARD = "credit_card"
    INVESTMENT = "investment"
    LOAN = "loan"
    CASH = "cash"

# Enhanced User Model
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    first_name = Column(String)
    last_name = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)

    # Relationships
    accounts = relationship("Account", back_populates="user")
    categories = relationship("Category", back_populates="user")
    budgets = relationship("Budget", back_populates="user")
    goals = relationship("Goal", back_populates="user")
    transactions = relationship("Transaction", back_populates="user")

# Account Management
class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String)
    type = Column(Enum(AccountType))
    balance = Column(Float, default=0.0)
    currency = Column(String, default="USD")
    institution = Column(String, nullable=True)
    account_number = Column(String, nullable=True)  # Last 4 digits only
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account")

# Category System
class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String)
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    color = Column(String, default="#3498db")
    icon = Column(String, nullable=True)
    is_income = Column(Boolean, default=False)
    is_savings = Column(Boolean, default=False)  # marks as savings — excluded from expenses
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="categories")
    parent = relationship("Category", remote_side=[id])
    subcategories = relationship("Category")
    transactions = relationship("Transaction", back_populates="category", foreign_keys="Transaction.category_id")
    budgets = relationship("Budget", back_populates="category")

# Transaction Management
class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    account_id = Column(Integer, ForeignKey("accounts.id"))
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    amount = Column(Float)
    description = Column(String)
    notes = Column(Text, nullable=True)
    transaction_type = Column(Enum(TransactionType))
    transaction_date = Column(DateTime)
    is_recurring = Column(Boolean, default=False)
    recurring_id = Column(String, nullable=True)  # UUID for recurring transaction groups
    recurring_frequency = Column(String, nullable=True)  # daily | weekly | bi-weekly | monthly | yearly
    recurring_day = Column(Integer, nullable=True)   # for monthly: day-of-month (e.g. 12)
    recurring_start_date = Column(DateTime, nullable=True)  # anchor date for weekly/bi-weekly
    recurring_end_date = Column(DateTime, nullable=True)    # last date this recurs (inclusive)
    tags = Column(String, nullable=True)  # JSON string of tags
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Plaid integration fields
    plaid_transaction_id = Column(String, nullable=True, unique=True, index=True)
    is_pending = Column(Boolean, default=False)          # True while Plaid marks as pending

    # AI categorization fields
    ai_category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    ai_confidence = Column(Float, nullable=True)       # 0.0–1.0
    ai_categorized = Column(Boolean, default=False)    # True once AI has run
    user_confirmed_category = Column(Boolean, default=False)  # True once user reviews

    # Relationships
    user = relationship("User", back_populates="transactions")
    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions", foreign_keys=[category_id])
    ai_category = relationship("Category", foreign_keys=[ai_category_id])

# Budget Management
class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    name = Column(String)
    budget_type = Column(Enum(BudgetType, values_callable=lambda obj: [e.value for e in obj]), default=BudgetType.MONTHLY)
    amount = Column(Float)
    spent = Column(Float, default=0.0)
    period_start = Column(DateTime)
    period_end = Column(DateTime)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="budgets")
    category = relationship("Category", back_populates="budgets")
    history = relationship("BudgetHistory", back_populates="budget", order_by="BudgetHistory.effective_from")


class BudgetHistory(Base):
    """Tracks every amount change for a budget so historical months see the correct figure."""
    __tablename__ = "budget_history"
    id = Column(Integer, primary_key=True, index=True)
    budget_id = Column(Integer, ForeignKey("budgets.id"), nullable=False)
    amount = Column(Float, nullable=False)
    # First calendar day of the month this amount took effect (e.g. 2026-04-01).
    # Use 1900-01-01 for the initial row so it covers all historical months.
    effective_from = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    budget = relationship("Budget", back_populates="history")


# Goal Management
class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String)
    goal_type = Column(Enum(GoalType))
    target_amount = Column(Float)
    current_amount = Column(Float, default=0.0)
    target_date = Column(DateTime, nullable=True)
    description = Column(Text, nullable=True)
    priority = Column(Integer, default=1)  # 1-5 scale
    is_completed = Column(Boolean, default=False)
    completed_at = Column(DateTime, nullable=True)
    # For debt_payoff goals: links to a Plaid account so balance is synced live
    plaid_account_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="goals")
    contributions = relationship("GoalContribution", back_populates="goal")

class GoalContribution(Base):
    __tablename__ = "goal_contributions"
    id = Column(Integer, primary_key=True, index=True)
    goal_id = Column(Integer, ForeignKey("goals.id"))
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=True)
    amount = Column(Float)
    contribution_date = Column(DateTime, default=datetime.utcnow)
    notes = Column(String, nullable=True)

    # Relationships
    goal = relationship("Goal", back_populates="contributions")

# AI Learning — user-trained category rules
class UserCategoryRule(Base):
    __tablename__ = "user_category_rules"
    id = Column(Integer, primary_key=True, index=True)
    keyword = Column(String, index=True)           # normalised merchant keyword
    category_id = Column(Integer, ForeignKey("categories.id"))
    usage_count = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    category = relationship("Category")


# Manual Debt Accounts (for institutions not supported by Plaid)
class ManualDebtAccount(Base):
    __tablename__ = "manual_debt_accounts"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    debt_type = Column(String, nullable=False)   # credit_card | student_loan | mortgage | personal_loan | auto | other
    institution_name = Column(String, nullable=True)
    current_balance = Column(Float, nullable=False, default=0.0)
    credit_limit = Column(Float, nullable=True)      # credit cards only
    interest_rate = Column(Float, nullable=True)     # APR %
    minimum_payment = Column(Float, nullable=True)
    next_payment_due_date = Column(String, nullable=True)  # stored as ISO date string
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Legacy Models (keeping for backward compatibility during migration)
class FixedExpense(Base):
    __tablename__ = "fixed_expenses"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String)
    amount = Column(Float)
    frequency = Column(String)  # daily, weekly, bi-weekly, monthly, yearly
    recurring_day = Column(Integer, nullable=True)  # e.g., 4 for 4th of month

class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    amount = Column(Float)
    category = Column(String)
    description = Column(String)
    type = Column(String, default="debit")  # credit or debit
    date = Column(DateTime, default=datetime.utcnow)

class Income(Base):
    __tablename__ = "incomes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    source = Column(String)
    amount = Column(Float)
    frequency = Column(String)  # daily, weekly, bi-weekly, monthly, yearly
    recurring_day = Column(Integer, nullable=True)  # e.g., 4 for 4th of month
    start_date = Column(DateTime, nullable=True)  # start date for recurring income
    date = Column(DateTime, default=datetime.utcnow)

# Balance Tracking
class BalanceSnapshot(Base):
    """
    A user-entered starting balance at a specific point in time.
    Current balance = amount + sum of all income/expenses after snapshot_date.
    Only the most recent snapshot is used as the baseline.
    """
    __tablename__ = "balance_snapshots"
    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Float, nullable=False)
    snapshot_date = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)


class PlannedExpense(Base):
    """A one-time future expense factored into the balance projection."""
    __tablename__ = "planned_expenses"
    id = Column(Integer, primary_key=True, index=True)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    planned_date = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class PlannedIncome(Base):
    """A one-time expected income event (e.g. bonus, tax refund) used in projections."""
    __tablename__ = "planned_incomes"
    id = Column(Integer, primary_key=True, index=True)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    planned_date = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# Plaid Integration
class PlaidItem(Base):
    """
    Stores a Plaid Item (bank connection) for a user.

    SECURITY NOTE: access_token is stored in plain text here, which is suitable
    for local development only. In production, encrypt this column using a
    library such as `sqlalchemy-utils EncryptedType` or store it in a secrets
    manager (AWS Secrets Manager, HashiCorp Vault, etc.).
    """
    __tablename__ = "plaid_items"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    item_id = Column(String, unique=True, index=True)          # Plaid item_id
    access_token = Column(String)                               # ENCRYPT IN PRODUCTION
    institution_name = Column(String, nullable=True)
    cursor = Column(String, nullable=True)                      # Plaid transaction sync cursor
    last_synced_at = Column(DateTime, nullable=True)
    # True when ALL accounts in this Item are credit/loan (e.g. a credit card bank).
    # Transactions from liability items are excluded from the balance tracker.
    is_liability = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account")


class PlaidBalanceSnapshot(Base):
    """
    Stores a point-in-time balance for each Plaid account.
    One row is captured per account per day whenever /api/plaid/balances is called.
    Used to reconstruct historical balance trends.
    """
    __tablename__ = "plaid_balance_snapshots"
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(String, nullable=False, index=True)
    plaid_account_id = Column(String, nullable=False, index=True)  # Plaid's account_id string
    account_name = Column(String, nullable=True)
    institution_name = Column(String, nullable=True)
    current = Column(Float, nullable=True)
    available = Column(Float, nullable=True)
    currency = Column(String, nullable=True)
    captured_at = Column(DateTime, default=datetime.utcnow, index=True)


class AppSettings(Base):
    """Simple key/value store for app-wide settings (e.g. savings base balance)."""
    __tablename__ = "app_settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=True)