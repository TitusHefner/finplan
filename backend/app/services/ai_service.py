"""
AI transaction categorisation service.

Strategy (in priority order):
  1. If the transaction's description matches a Plaid category directly mapped
     to one of our Category records → use it (confidence 1.0).
  2. Rule-based keyword matching against stored Category names (fast, free,
     works offline).
  3. OpenAI chat completion (only when OPENAI_API_KEY is set).

The caller receives a tuple: (category_id | None, confidence: float, method: str).
"""

from __future__ import annotations

import difflib
import os
import re
from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

# ── Rule-based keyword bank ────────────────────────────────────────────────
# Maps lowercase keywords → canonical category name fragments.
# We match against the Category.name stored in the DB so the list is flexible.

KEYWORD_RULES: list[tuple[str, str]] = [
    # Food & Dining
    (r"restaurant|cafe|coffee|starbucks|doordash|ubereats|grubhub|chipotle|mcdonald|subway|pizza|sushi|burger|taco|grocery|whole foods|trader joe|kroger|safeway|aldi|costco|sam'?s club", "food"),
    # Transport
    (r"uber|lyft|taxi|gas station|shell|bp|chevron|exxon|mobil|fuel|auto|parking|metro|transit|mta|bart|caltrain|toll|delta|united|southwest|american airlines|amtrak", "transport"),
    # Entertainment
    (r"netflix|hulu|disney|spotify|apple music|youtube|cinema|movie|theater|concert|ticketmaster|steam|playstation|xbox|amazon prime|hbo", "entertainment"),
    # Utilities
    (r"electric|water bill|gas bill|internet|comcast|at&t|verizon|t-mobile|utilities|xfinity|spectrum|pg&e|con edison", "utilities"),
    # Healthcare
    (r"pharmacy|cvs|walgreens|rite aid|doctor|dentist|hospital|clinic|medical|health|insurance|copay|lab|urgent care", "health"),
    # Shopping
    (r"amazon|walmart|target|best buy|home depot|lowes|ikea|nordstrom|macy|gap|h&m|zara|ebay|etsy|shopify", "shopping"),
    # Rent / Housing
    (r"rent|mortgage|hoa|real estate|lease|landlord|property management", "rent|housing"),
    # Subscriptions & Software
    (r"subscription|adobe|microsoft|google.*storage|dropbox|notion|zoom|slack|github", "subscription|software"),
    # Income
    (r"payroll|salary|direct deposit|zelle|venmo|paypal|transfer in|refund|reimbursement", "income|salary"),
]


def _match_rules(description: str, categories: list) -> tuple[Optional[int], float]:
    """Return (category_id, confidence) for the best keyword match or (None, 0)."""
    desc_lower = description.lower()
    for pattern, cat_hint in KEYWORD_RULES:
        if re.search(pattern, desc_lower):
            # Find the best matching category in the DB
            hints = [h.strip().lower() for h in cat_hint.split("|")]
            for cat in categories:
                cat_name = cat.name.lower()
                if any(h in cat_name or cat_name in h for h in hints):
                    return cat.id, 0.80
    return None, 0.0


def _call_openai(description: str, category_names: list[str]) -> tuple[Optional[str], float]:
    """
    Call an OpenAI-compatible Chat API for categorisation.
    Prefers Groq (GROQ_API_KEY) over OpenAI (OPENAI_API_KEY).
    Returns (matched_category_name_or_None, confidence).
    Falls back gracefully if the API is unavailable.
    """
    try:
        from openai import OpenAI
        groq_key = os.getenv("GROQ_API_KEY")
        if groq_key:
            client = OpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
            model = "llama-3.3-70b-versatile"
        else:
            client = OpenAI()  # reads OPENAI_API_KEY from env
            model = "gpt-4o-mini"

        cats = ", ".join(category_names)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a financial transaction categoriser. "
                        "Given a transaction description, pick the single best category "
                        f"from this list: [{cats}]. "
                        "If none fits, reply with 'Other'. "
                        "Reply with ONLY the category name and a confidence score 0-100, "
                        "separated by a pipe. Example: Food|85"
                    ),
                },
                {"role": "user", "content": description},
            ],
            max_tokens=30,
            temperature=0,
        )
        raw = response.choices[0].message.content.strip()
        parts = raw.split("|")
        name = parts[0].strip() if parts else None
        confidence = int(parts[1].strip()) / 100.0 if len(parts) > 1 else 0.75
        return name, min(confidence, 1.0)
    except Exception:
        return None, 0.0


# ── Description normalisation ──────────────────────────────────────────────

def _normalize(description: str) -> str:
    """
    Strip transaction IDs, hashes, card numbers and noise from a description
    so that "Tilt XXXXXX9349 acdf7a0968fd45" and "Tilt XXXXXX0012 bb3a..." 
    both become "tilt" and match each other.
    """
    s = description.lower()
    # Remove hex strings (6+ hex chars)
    s = re.sub(r'\b[0-9a-f]{6,}\b', '', s)
    # Remove sequences of X's (masked card numbers etc)
    s = re.sub(r'x{3,}\d*', '', s)
    # Remove pure numbers
    s = re.sub(r'\b\d+\b', '', s)
    # Remove punctuation except spaces
    s = re.sub(r'[^\w\s]', ' ', s)
    # Collapse whitespace
    s = ' '.join(s.split())
    return s


def _extract_keyword(description: str) -> str:
    """Normalise a transaction description down to 1-3 meaningful words for rule storage."""
    cleaned = _normalize(description)
    words = [w for w in cleaned.split() if len(w) > 2]
    return ' '.join(words[:3]).strip()


# ── Fuzzy match against user-confirmed transactions ────────────────────────

def _match_confirmed_transactions(description: str, db: Session) -> tuple[Optional[int], float]:
    """
    Find the most similar transaction that the user has already manually categorised.
    Uses difflib similarity on normalised descriptions.
    Returns (category_id, confidence) or (None, 0).
    """
    from app.models import Transaction

    norm_new = _normalize(description)
    if not norm_new:
        return None, 0.0

    confirmed = (
        db.query(Transaction.description, Transaction.category_id)
        .filter(
            Transaction.user_confirmed_category == True,
            Transaction.category_id.isnot(None),
        )
        .all()
    )

    best_ratio = 0.0
    best_cat_id = None

    for row in confirmed:
        if not row.description:
            continue
        norm_existing = _normalize(row.description)
        if not norm_existing:
            continue
        ratio = difflib.SequenceMatcher(None, norm_new, norm_existing).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_cat_id = row.category_id

    if best_ratio >= 0.65 and best_cat_id is not None:
        # Scale confidence: 0.65 similarity → 0.80, 1.0 → 0.97
        confidence = 0.80 + (best_ratio - 0.65) * (0.17 / 0.35)
        return best_cat_id, round(min(confidence, 0.97), 2)

    return None, 0.0


def save_user_rule(description: str, category_id: int, db: Session) -> None:
    """
    Persist a user correction as a learned rule.
    Called whenever the user confirms or changes a category.
    """
    from app.models import UserCategoryRule
    keyword = _extract_keyword(description)
    if not keyword:
        return
    existing = (
        db.query(UserCategoryRule)
        .filter(
            UserCategoryRule.keyword == keyword,
            UserCategoryRule.category_id == category_id,
        )
        .first()
    )
    if existing:
        existing.usage_count += 1
        existing.updated_at = datetime.utcnow()
    else:
        db.add(UserCategoryRule(keyword=keyword, category_id=category_id))
    db.commit()


def _match_user_rules(description: str, db: Session) -> tuple[Optional[int], float]:
    """Return (category_id, confidence) from learned user rules, or (None, 0)."""
    from app.models import UserCategoryRule
    desc_lower = description.lower()
    rules = (
        db.query(UserCategoryRule)
        .order_by(UserCategoryRule.usage_count.desc())
        .all()
    )
    for rule in rules:
        if rule.keyword and rule.keyword in desc_lower:
            return rule.category_id, 0.95
    return None, 0.0


# ── Public API ─────────────────────────────────────────────────────────────


def categorize_transaction(
    description: str,
    db: Session,
    plaid_category: Optional[str] = None,
) -> Tuple[Optional[int], float, str]:
    """
    Auto-categorise a single transaction.

    Returns (category_id, confidence, method) where method is one of:
      "user"     – matched by a user-trained keyword rule (highest priority)
      "similar"  – fuzzy-matched to a previously confirmed transaction
      "plaid"    – matched directly from Plaid's category
      "rule"     – matched by keyword rules
      "openai"   – matched via OpenAI
      "none"     – no match found
    """
    from app.models import Category

    categories = db.query(Category).filter(Category.is_active == True).all()
    if not categories:
        return None, 0.0, "none"

    # 0. User-trained keyword rules (highest priority — personalised learning)
    cat_id, confidence = _match_user_rules(description, db)
    if cat_id:
        return cat_id, confidence, "user"

    # 0b. Fuzzy match against previously confirmed transactions
    cat_id, confidence = _match_confirmed_transactions(description, db)
    if cat_id:
        return cat_id, confidence, "similar"

    # 1. Plaid category hint
    if plaid_category:
        plaid_lower = plaid_category.lower()
        for cat in categories:
            if cat.name.lower() in plaid_lower or plaid_lower in cat.name.lower():
                return cat.id, 1.0, "plaid"

    # 2. Rule-based keyword matching
    cat_id, confidence = _match_rules(description, categories)
    if cat_id:
        return cat_id, confidence, "rule"

    # 3. Groq / OpenAI (only if an API key is configured)
    if os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY"):
        names = [c.name for c in categories]
        matched_name, confidence = _call_openai(description, names)
        if matched_name and matched_name.lower() != "other":
            for cat in categories:
                if cat.name.lower() == matched_name.lower():
                    return cat.id, confidence, "openai"

    return None, 0.0, "none"


def bulk_categorize(transaction_ids: List[int], db: Session) -> int:
    """
    Run categorisation on every uncategorised transaction in `transaction_ids`.
    Returns the count of transactions that received a suggestion.
    """
    from app.models import Transaction

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.id.in_(transaction_ids),
            Transaction.ai_categorized == False,
        )
        .all()
    )

    updated = 0
    for tx in txs:
        cat_id, confidence, _ = categorize_transaction(tx.description, db)
        tx.ai_category_id = cat_id
        tx.ai_confidence = confidence
        tx.ai_categorized = True
        if cat_id and not tx.category_id:
            tx.category_id = cat_id
        updated += 1

    db.commit()
    return updated
