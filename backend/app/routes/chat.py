"""
AI Financial Advisor chat endpoint.

POST /api/chat/message   — send a message, get a reply (+ optional pending action)
POST /api/chat/execute   — user confirmed; execute a pending action against the DB
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Load .env from backend/ (parent of this file's routes/ directory)
load_dotenv(Path(__file__).parent.parent.parent / ".env")

from app import database, models
from app.services.analytics import AnalyticsService
from app.services.ai_service import categorize_transaction, save_user_rule

router = APIRouter()


# ── Pydantic models ────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []

class PendingAction(BaseModel):
    type: str           # "add_transaction" | "add_budget" | "add_goal"
    data: Dict[str, Any]
    prompt: str         # Human-readable confirmation question

class ChatResponse(BaseModel):
    reply: str
    pending_action: Optional[PendingAction] = None

class ExecuteRequest(BaseModel):
    action: PendingAction


# ── System prompt builder ──────────────────────────────────────────────────

def _build_system_prompt(db: Session) -> str:
    service = AnalyticsService(db)
    try:
        summary = service.get_financial_summary()
    except Exception:
        summary = {}
    try:
        monthly = service.get_monthly_breakdown(months=3)
    except Exception:
        monthly = []

    cats = db.query(models.Category).filter(models.Category.is_active == True).all()
    cat_lines = "\n".join(
        f"  [{c.id}] {c.name} ({'income' if c.is_income else 'expense'})"
        for c in cats
    )

    monthly_lines = (
        "\n".join(
            f"  {m['month']}: Income ${m['income']:,.2f} | Expenses ${m['expenses']:,.2f} | "
            f"Savings {m['savings_rate']:.1f}% | {m['transaction_count']} transactions"
            for m in monthly
        )
        if monthly else "  No historical data yet."
    )

    today = date.today().isoformat()
    balance = summary.get("total_balance", 0)
    income = summary.get("monthly_income", 0)
    expenses = summary.get("monthly_expenses", 0)
    savings_rate = summary.get("savings_rate", 0)

    return f"""You are a highly skilled personal AI financial advisor embedded in the user's finance app. \
You have real-time access to the user's actual financial data via tool calls and you speak with them \
conversationally to help them achieve financial wellbeing.

## User's Current Financial Snapshot
- Total Balance: ${balance:,.2f}
- This Month ({date.today().strftime("%B %Y")}) Income: ${income:,.2f}
- This Month Expenses: ${expenses:,.2f}
- This Month Savings Rate: {savings_rate:.1f}%
- Today's Date: {today}

## Monthly Summary (last 3 months)
{monthly_lines}

## Available Categories (use these IDs when proposing transactions)
{cat_lines}

## Your Tools
You have three tools to fetch live data on demand — use them freely whenever you need details:
- **query_transactions**: filter by date range, category, type, or keyword. Use this for any "show me", "how much did I spend on X", "what were my April expenses" questions.
- **get_monthly_summary**: income/expenses/savings rate per month. Use for trend questions.
- **get_category_spending**: spending totals by category for any date range.

Always call a tool rather than saying "I don't have that data." If the user asks about a specific month, category, or merchant, query it.

## Your Role & Capabilities
- Analyse spending patterns and provide personalised, actionable advice
- Answer any question about the user's finances using tool data
- Identify risks: overspending categories, low savings rate, missing emergency fund, etc.
- Help set and track financial goals
- When the user mentions spending money or receiving income, extract the details and **propose** adding it
- Be empathetic, specific, and non-judgmental

## Proposing Actions (VERY IMPORTANT)
When you want to add a transaction, budget, or goal on behalf of the user, you MUST ask permission \
by appending a JSON action block EXACTLY as shown below at the END of your response. \
Do NOT execute anything without the user's explicit confirmation.

To add a transaction (expense):
```action
{{"type":"add_transaction","data":{{"amount":-50.00,"description":"Groceries","category_id":1,"transaction_type":"expense","transaction_date":"{today}"}},"prompt":"Add a $50.00 expense for Groceries today?"}}
```

To add income:
```action
{{"type":"add_transaction","data":{{"amount":5000.00,"description":"Salary","category_id":13,"transaction_type":"income","transaction_date":"{today}"}},"prompt":"Add $5,000.00 income for Salary today?"}}
```

To add a budget:
```action
{{"type":"add_budget","data":{{"name":"Food Budget","category_id":1,"amount":400.00,"period_start":"{today}","period_end":"{today[:7]}-30"}},"prompt":"Create a $400/month Food budget?"}}
```

Rules:
- Use negative amounts for expenses, positive for income
- Always pick the most fitting category_id from the list above
- Only produce ONE ```action block per response
- If you are not proposing an action, do NOT include a code block
- Keep responses concise unless the user asks for detail
"""


# ── Helper: extract pending action from LLM reply ─────────────────────────

_ACTION_RE = re.compile(r'```action\s*(\{.*?\})\s*```', re.DOTALL)

def _parse_action(text: str) -> tuple[str, Optional[PendingAction]]:
    """Strip the ```action block from text and return (clean_text, action|None)."""
    m = _ACTION_RE.search(text)
    if not m:
        return text.strip(), None
    try:
        obj = json.loads(m.group(1))
        action = PendingAction(
            type=obj["type"],
            data=obj["data"],
            prompt=obj.get("prompt", "Confirm this action?"),
        )
        clean = text[:m.start()].strip()
        return clean, action
    except (json.JSONDecodeError, KeyError):
        return text.strip(), None


# ── Tool definitions (OpenAI function-calling format) ──────────────────────

CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_transactions",
            "description": (
                "Search transactions in the database. Use this for any question about "
                "specific spending, income, or when the user asks about a time period, "
                "category, or merchant. Returns a list of matching transactions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date (YYYY-MM-DD, inclusive). Omit for no lower bound.",
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date (YYYY-MM-DD, inclusive). Omit for no upper bound.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Filter by category name (partial, case-insensitive).",
                    },
                    "transaction_type": {
                        "type": "string",
                        "enum": ["income", "expense", "all"],
                        "description": "Filter by type. Default: all.",
                    },
                    "description_search": {
                        "type": "string",
                        "description": "Search in transaction description (partial, case-insensitive).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max rows to return (default 100, max 500).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_monthly_summary",
            "description": (
                "Get income, expenses, and savings rate summarised by calendar month. "
                "Use for trend analysis or when asked about a specific month's totals."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "months": {
                        "type": "integer",
                        "description": "Number of recent months to include (default 6).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_category_spending",
            "description": (
                "Get spending totals grouped by category for any date range. "
                "Use when asked 'what did I spend most on in April' or similar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date (YYYY-MM-DD). Omit for all time.",
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date (YYYY-MM-DD). Omit for all time.",
                    },
                },
                "required": [],
            },
        },
    },
]


def _execute_tool(name: str, args: dict, db: Session) -> str:
    """Run a tool call and return its result as a JSON string."""
    service = AnalyticsService(db)
    try:
        if name == "query_transactions":
            result = service.query_transactions(**args)
        elif name == "get_monthly_summary":
            months = int(args.get("months", 6))
            result = service.get_monthly_breakdown(months=months)
        elif name == "get_category_spending":
            result = service.get_category_spending(
                start_date=args.get("start_date"),
                end_date=args.get("end_date"),
            )
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as exc:
        result = {"error": str(exc)}
    return json.dumps(result)


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/status")
def chat_status():
    """Check whether the AI chat feature is available on this network."""
    groq_key = os.environ.get("GROQ_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not groq_key and not openai_key:
        return {"available": False, "reason": "no_api_key"}
    check_url = "https://api.groq.com" if groq_key else "https://api.openai.com"
    try:
        import httpx
        httpx.get(check_url, timeout=4)
        return {"available": True}
    except Exception:
        return {"available": False, "reason": "network_blocked"}


@router.post("/message", response_model=ChatResponse)
def chat_message(payload: ChatRequest, db: Session = Depends(database.get_db)):
    groq_key = os.environ.get("GROQ_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not groq_key and not openai_key:
        return ChatResponse(
            reply=(
                "I need an API key to respond. "
                "Add GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY "
                "to your backend/.env file and restart the server."
            )
        )

    try:
        from openai import OpenAI
        if groq_key:
            client = OpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
            chat_model = "llama-3.3-70b-versatile"
        else:
            client = OpenAI(api_key=openai_key)
            chat_model = "gpt-4o-mini"
    except ImportError:
        return ChatResponse(reply="openai package is not installed. Run: pip install openai")

    system_prompt = _build_system_prompt(db)

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    # Keep last 20 exchanges to stay within context limits
    for msg in payload.history[-20:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": payload.message})

    try:
        # Agentic loop: let the AI call tools as many times as it needs (max 8 rounds)
        for _ in range(8):
            response = client.chat.completions.create(
                model=chat_model,
                messages=messages,
                tools=CHAT_TOOLS,
                tool_choice="auto",
                temperature=0.7,
                max_tokens=1200,
                timeout=60,
            )
            msg = response.choices[0].message

            # No tool calls → final answer
            if not msg.tool_calls:
                full_reply = msg.content or ""
                break

            # Execute every tool call the model requested
            messages.append(msg)  # assistant message with tool_calls
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                tool_result = _execute_tool(tc.function.name, args, db)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result,
                })
        else:
            full_reply = "I reached the maximum number of tool calls. Please try a more specific question."
    except Exception as exc:
        exc_type = type(exc).__name__
        exc_str = str(exc)
        if "Connection" in exc_type or "connect" in exc_str.lower() or "SSL" in exc_str.upper():
            return ChatResponse(
                reply="⚠️ The AI Advisor is unavailable on this network — the OpenAI API is blocked by your corporate firewall. "
                      "All other app features (transactions, budgets, bank sync) continue to work normally."
            )
        if "Authentication" in exc_type or "auth" in exc_str.lower() or "401" in exc_str:
            return ChatResponse(
                reply="OpenAI authentication failed. Please check that your OPENAI_API_KEY in backend/.env is valid."
            )
        if "RateLimit" in exc_type or "insufficient_quota" in exc_str or "429" in exc_str:
            return ChatResponse(
                reply="⚠️ Your OpenAI account has exceeded its quota. "
                      "Please check your billing details at https://platform.openai.com/account/billing "
                      "and add credits to your account, then try again."
            )
        return ChatResponse(reply=f"OpenAI error ({exc_type}): {exc_str}")

    display_reply, pending_action = _parse_action(full_reply)
    return ChatResponse(reply=display_reply, pending_action=pending_action)


@router.post("/execute")
def execute_action(payload: ExecuteRequest, db: Session = Depends(database.get_db)):
    """User confirmed a pending action — execute it against the database."""
    action = payload.action
    data = action.data

    if action.type == "add_transaction":
        raw_date = data.get("transaction_date", date.today().isoformat())
        tx_date = (
            datetime.fromisoformat(raw_date)
            if isinstance(raw_date, str)
            else datetime(*raw_date[:3])
        )
        tx_type_str = data.get("transaction_type", "expense").lower()
        try:
            tx_type = models.TransactionType(tx_type_str)
        except ValueError:
            tx_type = models.TransactionType.EXPENSE

        cat_id = data.get("category_id")

        tx = models.Transaction(
            amount=float(data["amount"]),
            description=data.get("description", ""),
            category_id=cat_id,
            transaction_type=tx_type,
            transaction_date=tx_date,
            ai_categorized=bool(cat_id),
            user_confirmed_category=True,
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)

        # Learn from this user-provided categorisation
        if cat_id and tx.description:
            save_user_rule(tx.description, cat_id, db)

        return {
            "success": True,
            "message": f"Added: {tx.description} (${abs(tx.amount):.2f})",
            "id": tx.id,
        }

    if action.type == "add_budget":
        period_start = datetime.fromisoformat(data.get("period_start", date.today().isoformat()))
        period_end_str = data.get("period_end")
        if period_end_str:
            period_end = datetime.fromisoformat(period_end_str)
        else:
            # Default to end of current month
            import calendar
            today = date.today()
            last_day = calendar.monthrange(today.year, today.month)[1]
            period_end = datetime(today.year, today.month, last_day)

        budget = models.Budget(
            name=data["name"],
            category_id=data.get("category_id"),
            amount=float(data["amount"]),
            period_start=period_start,
            period_end=period_end,
            budget_type=models.BudgetType.MONTHLY,
        )
        db.add(budget)
        db.commit()
        db.refresh(budget)
        return {
            "success": True,
            "message": f"Created budget: {budget.name} (${budget.amount:.2f}/month)",
            "id": budget.id,
        }

    if action.type == "add_goal":
        target_date = None
        if data.get("target_date"):
            target_date = datetime.fromisoformat(data["target_date"])
        goal = models.Goal(
            name=data["name"],
            goal_type=models.GoalType.SAVINGS,
            target_amount=float(data["target_amount"]),
            current_amount=float(data.get("current_amount", 0)),
            target_date=target_date,
            description=data.get("description"),
        )
        db.add(goal)
        db.commit()
        db.refresh(goal)
        return {
            "success": True,
            "message": f"Goal created: {goal.name} (target: ${goal.target_amount:,.2f})",
            "id": goal.id,
        }

    raise HTTPException(status_code=400, detail=f"Unknown action type: {action.type}")
