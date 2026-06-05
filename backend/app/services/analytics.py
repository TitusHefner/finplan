from sqlalchemy.orm import Session
from sqlalchemy import func, extract, and_, or_
from datetime import datetime, timedelta
from typing import Dict, List, Any
import calendar

class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db

    def get_financial_summary(self, user_id: int = None) -> Dict[str, Any]:
        """Get comprehensive financial summary"""
        # Account balances
        from app.models import Account
        accounts = self.db.query(Account).filter(Account.is_active == True).all()
        total_balance = sum(account.balance for account in accounts)

        # Monthly income and expenses
        current_month = datetime.now().month
        current_year = datetime.now().year

        from app.models import Transaction
        monthly_transactions = self.db.query(Transaction).filter(
            extract('month', Transaction.transaction_date) == current_month,
            extract('year', Transaction.transaction_date) == current_year
        ).all()

        from app.models import TransactionType
        monthly_income = sum(t.amount for t in monthly_transactions if t.transaction_type == TransactionType.INCOME)
        monthly_expenses = abs(sum(t.amount for t in monthly_transactions if t.transaction_type == TransactionType.EXPENSE))

        savings_rate = (monthly_income - monthly_expenses) / monthly_income * 100 if monthly_income > 0 else 0

        return {
            "total_balance": total_balance,
            "monthly_income": monthly_income,
            "monthly_expenses": monthly_expenses,
            "savings_rate": round(savings_rate, 1),
            "accounts_count": len(accounts),
            "transactions_count": len(monthly_transactions)
        }

    def get_monthly_breakdown(self, months: int = 3) -> List[Dict[str, Any]]:
        """Return income, expenses, and savings rate for each of the last N months."""
        from app.models import Transaction, TransactionType
        results = []
        now = datetime.now()
        for i in range(months - 1, -1, -1):
            # Calculate year/month for i months ago
            month = now.month - i
            year = now.year
            while month <= 0:
                month += 12
                year -= 1
            import calendar as _cal
            last_day = _cal.monthrange(year, month)[1]
            start = datetime(year, month, 1)
            end = datetime(year, month, last_day, 23, 59, 59)
            txs = self.db.query(Transaction).filter(
                Transaction.transaction_date >= start,
                Transaction.transaction_date <= end,
            ).all()
            income = sum(t.amount for t in txs if t.transaction_type == TransactionType.INCOME)
            expenses = abs(sum(t.amount for t in txs if t.transaction_type == TransactionType.EXPENSE))
            savings_rate = (income - expenses) / income * 100 if income > 0 else 0
            results.append({
                "month": start.strftime("%B %Y"),
                "income": round(income, 2),
                "expenses": round(expenses, 2),
                "savings_rate": round(savings_rate, 1),
                "transaction_count": len(txs),
            })
        return results

    def query_transactions(
        self,
        start_date: str = None,
        end_date: str = None,
        category: str = None,
        transaction_type: str = "all",
        description_search: str = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Flexible transaction query used by the AI tool-call handler.
        All parameters are optional.
        """
        from app.models import Transaction, Category, TransactionType

        limit = min(int(limit), 500)
        q = self.db.query(Transaction, Category.name).outerjoin(
            Category, Transaction.category_id == Category.id
        )
        if start_date:
            q = q.filter(Transaction.transaction_date >= datetime.fromisoformat(start_date))
        if end_date:
            # include the whole end day
            end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
            q = q.filter(Transaction.transaction_date <= end_dt)
        if transaction_type and transaction_type != "all":
            try:
                tt = TransactionType(transaction_type.lower())
                q = q.filter(Transaction.transaction_type == tt)
            except ValueError:
                pass
        if category:
            q = q.filter(Category.name.ilike(f"%{category}%"))
        if description_search:
            q = q.filter(Transaction.description.ilike(f"%{description_search}%"))

        rows = q.order_by(Transaction.transaction_date.desc()).limit(limit).all()
        out = []
        for tx, cat_name in rows:
            out.append({
                "id": tx.id,
                "date": tx.transaction_date.strftime("%Y-%m-%d") if tx.transaction_date else "",
                "description": tx.description or "",
                "amount": tx.amount,
                "type": tx.transaction_type.value if tx.transaction_type else "",
                "category": cat_name or "Uncategorized",
            })
        return out

    def get_category_spending(
        self,
        start_date: str = None,
        end_date: str = None,
    ) -> List[Dict[str, Any]]:
        """Spending totals by category for an arbitrary date range."""
        from app.models import Transaction, Category, TransactionType

        q = self.db.query(
            Category.name,
            func.sum(Transaction.amount).label("total"),
        ).outerjoin(Transaction, Transaction.category_id == Category.id).filter(
            Transaction.transaction_type == TransactionType.EXPENSE,
        )
        if start_date:
            q = q.filter(Transaction.transaction_date >= datetime.fromisoformat(start_date))
        if end_date:
            end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
            q = q.filter(Transaction.transaction_date <= end_dt)
        rows = q.group_by(Category.name).order_by(func.sum(Transaction.amount)).all()
        return [{"category": row[0], "amount": round(abs(row[1] or 0), 2)} for row in rows]

    def get_recent_transactions(self, limit: int = 40) -> List[Dict[str, Any]]:
        """Return the most recent transactions with category names."""
        from app.models import Transaction, Category
        rows = (
            self.db.query(Transaction, Category.name)
            .outerjoin(Category, Transaction.category_id == Category.id)
            .order_by(Transaction.transaction_date.desc())
            .limit(limit)
            .all()
        )
        out = []
        for tx, cat_name in rows:
            out.append({
                "date": tx.transaction_date.strftime("%Y-%m-%d") if tx.transaction_date else "",
                "description": tx.description or "",
                "amount": tx.amount,
                "type": tx.transaction_type.value if tx.transaction_type else "",
                "category": cat_name or "Uncategorized",
            })
        return out

    def get_spending_by_category(self, months: int = 3) -> List[Dict[str, Any]]:
        """Get spending breakdown by category"""
        from app.models import Transaction, Category

        start_date = datetime.now() - timedelta(days=30 * months)

        results = self.db.query(
            Category.name,
            func.sum(Transaction.amount).label('total_spent')
        ).join(Transaction).filter(
            Transaction.transaction_type == 'expense',
            Transaction.transaction_date >= start_date
        ).group_by(Category.name).all()

        return [
            {"category": row[0], "amount": abs(row[1]), "percentage": 0}
            for row in results
        ]

    def get_budget_performance(self) -> List[Dict[str, Any]]:
        """Get budget vs actual spending"""
        from app.models import Budget, Transaction, Category

        budgets = self.db.query(Budget).filter(Budget.is_active == True).all()
        performance = []

        for budget in budgets:
            # Calculate actual spending for the budget period
            actual_spent = self.db.query(func.sum(Transaction.amount)).filter(
                Transaction.category_id == budget.category_id,
                Transaction.transaction_type == 'expense',
                Transaction.transaction_date.between(budget.period_start, budget.period_end)
            ).scalar() or 0

            actual_spent = abs(actual_spent)

            performance.append({
                "budget_name": budget.name,
                "budgeted": budget.amount,
                "spent": actual_spent,
                "remaining": budget.amount - actual_spent,
                "percentage": (actual_spent / budget.amount * 100) if budget.amount > 0 else 0,
                "status": "over" if actual_spent > budget.amount else "under"
            })

        return performance

    def get_cash_flow_forecast(self, months: int = 6) -> List[Dict[str, Any]]:
        """Generate cash flow forecast"""
        from app.models import Transaction, Income

        forecast = []
        current_date = datetime.now()

        for i in range(months):
            month_start = current_date.replace(day=1) + timedelta(days=32 * i)
            month_start = month_start.replace(day=1)
            month_end = month_start.replace(day=calendar.monthrange(month_start.year, month_start.month)[1])

            # Projected income
            recurring_income = self.db.query(func.sum(Income.amount)).filter(
                Income.frequency == 'monthly'
            ).scalar() or 0

            # Projected expenses
            monthly_expenses = self.db.query(func.sum(Transaction.amount)).filter(
                Transaction.transaction_type == 'expense',
                extract('month', Transaction.transaction_date) == month_start.month,
                extract('year', Transaction.transaction_date) == month_start.year
            ).scalar() or 0

            monthly_expenses = abs(monthly_expenses)

            net_flow = recurring_income - monthly_expenses

            forecast.append({
                "month": month_start.strftime("%B %Y"),
                "projected_income": recurring_income,
                "projected_expenses": monthly_expenses,
                "net_flow": net_flow
            })

        return forecast

    def get_financial_health_score(self) -> Dict[str, Any]:
        """Calculate overall financial health score"""
        summary = self.get_financial_summary()

        # Scoring criteria (0-100 scale)
        scores = {
            "emergency_fund": min(summary.get("total_balance", 0) / 10000 * 100, 100),  # 3-6 months expenses
            "savings_rate": min(summary.get("savings_rate", 0) * 2, 100),  # Target 20% savings rate
            "debt_to_income": 100,  # Placeholder - would need debt data
            "budget_adherence": 85,  # Placeholder - would calculate from budget performance
        }

        overall_score = sum(scores.values()) / len(scores)

        return {
            "overall_score": round(overall_score, 1),
            "scores": scores,
            "grade": self._get_grade(overall_score),
            "recommendations": self._get_recommendations(scores)
        }

    def _get_grade(self, score: float) -> str:
        """Convert score to letter grade"""
        if score >= 90: return "A"
        elif score >= 80: return "B"
        elif score >= 70: return "C"
        elif score >= 60: return "D"
        else: return "F"

    def _get_recommendations(self, scores: Dict[str, float]) -> List[str]:
        """Generate personalized recommendations"""
        recommendations = []

        if scores.get("emergency_fund", 0) < 50:
            recommendations.append("Build your emergency fund to cover 3-6 months of expenses")

        if scores.get("savings_rate", 0) < 40:
            recommendations.append("Aim to save at least 20% of your income")

        if scores.get("budget_adherence", 0) < 80:
            recommendations.append("Track your spending more closely against your budget")

        return recommendations

    def get_spending_trends(self, months: int = 12) -> List[Dict[str, Any]]:
        """Analyze spending trends over time"""
        from app.models import Transaction

        trends = []
        current_date = datetime.now()

        for i in range(months):
            month_date = current_date - timedelta(days=30 * i)
            month_start = month_date.replace(day=1)
            month_end = month_start.replace(day=calendar.monthrange(month_start.year, month_start.month)[1])

            monthly_spending = self.db.query(func.sum(Transaction.amount)).filter(
                Transaction.transaction_type == 'expense',
                Transaction.transaction_date.between(month_start, month_end)
            ).scalar() or 0

            trends.append({
                "month": month_start.strftime("%B %Y"),
                "amount": abs(monthly_spending),
                "date": month_start.isoformat()
            })

        return list(reversed(trends))  # Most recent first

    def get_top_spending_categories(self, limit: int = 5) -> List[Dict[str, Any]]:
        """Get top spending categories"""
        from app.models import Transaction, Category

        results = self.db.query(
            Category.name,
            func.sum(Transaction.amount).label('total')
        ).join(Transaction).filter(
            Transaction.transaction_type == 'expense'
        ).group_by(Category.name).order_by(func.sum(Transaction.amount).desc()).limit(limit).all()

        return [
            {"category": row[0], "amount": abs(row[1])}
            for row in results
        ]