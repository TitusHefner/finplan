"""
One-shot script: re-categorize all transactions that have no ai_category_id.
Run from the backend/ folder:
    python recategorize.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app import models
from app.services.ai_service import categorize_transaction

db = SessionLocal()
txs = db.query(models.Transaction).filter(models.Transaction.ai_category_id == None).all()
print(f"Transactions to categorize: {len(txs)}")

updated = 0
for tx in txs:
    cat_id, confidence, method = categorize_transaction(tx.description or "", db, None)
    tx.ai_categorized = True
    if cat_id:
        tx.ai_category_id = cat_id
        tx.category_id = tx.category_id or cat_id
        tx.ai_confidence = confidence
        updated += 1

db.commit()
print(f"Done. Categorized {updated}/{len(txs)} transactions.")

cats = {c.id: c.name for c in db.query(models.Category).all()}
sample = db.query(models.Transaction).filter(models.Transaction.ai_category_id != None).limit(8).all()
print("\nSample results:")
for t in sample:
    print(f"  {t.description[:40]:40s} -> {cats.get(t.ai_category_id, '?')} ({(t.ai_confidence or 0):.0%})")

db.close()
