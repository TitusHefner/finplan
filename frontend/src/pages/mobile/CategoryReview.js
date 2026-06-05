import React, { useState, useEffect, useCallback } from 'react';
import axios from '../../api';

const fmt = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const confidenceLabel = (c) => {
  if (!c) return '';
  if (c >= 0.9) return '✅ High confidence';
  if (c >= 0.7) return '⚠️ Medium confidence';
  return '❓ Low confidence';
};

const confidenceColor = (c) => {
  if (!c) return '#8e8e93';
  if (c >= 0.9) return '#34c759';
  if (c >= 0.7) return '#ff9500';
  return '#ff3b30';
};

// ── Single review card ─────────────────────────────────────────────────────

function ReviewCard({ item, onConfirm, onRecategorize }) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState(
    item.ai_category_id ? String(item.ai_category_id) : ''
  );
  const [saving, setSaving] = useState(false);

  const incomeCategories = item.available_categories.filter((c) => c.is_income);
  const expenseCategories = item.available_categories.filter((c) => !c.is_income);
  const isIncome = item.transaction_type === 'income';
  const relevantCats = isIncome ? incomeCategories : expenseCategories;

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm(item.id, item.ai_category_id);
    setSaving(false);
  };

  const handleChange = async () => {
    if (!selectedCatId) return;
    setSaving(true);
    await onRecategorize(item.id, Number(selectedCatId));
    setSaving(false);
  };

  return (
    <div className="m-card" style={{ position: 'relative' }}>
      {/* Transaction info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 600, flex: 1, marginRight: 8 }}>
          {item.description}
        </span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: isIncome ? '#34c759' : '#ff3b30',
            whiteSpace: 'nowrap',
          }}
        >
          {isIncome ? '+' : '-'}{fmt(Math.abs(item.amount))}
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12 }}>
        {item.account_name && <span>{item.account_name} · </span>}
        {new Date(item.transaction_date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </div>

      {/* AI suggestion */}
      <div
        style={{
          background: '#f9f9fb',
          borderRadius: 10,
          padding: '10px 12px',
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 4 }}>
          AI Suggestion
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 500 }}>
            {item.ai_category_name ?? '—'}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: confidenceColor(item.ai_confidence),
            }}
          >
            {confidenceLabel(item.ai_confidence)}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      {!showPicker ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="m-btn-save"
            style={{ flex: 1, padding: '11px', borderRadius: 10, fontSize: 15 }}
            onClick={handleConfirm}
            disabled={saving || !item.ai_category_id}
          >
            {saving ? '…' : '✓ Confirm'}
          </button>
          <button
            style={{
              flex: 1,
              padding: '11px',
              borderRadius: 10,
              border: '1px solid #d1d1d6',
              background: 'none',
              cursor: 'pointer',
              fontSize: 15,
              color: '#1c1c1e',
              fontWeight: 500,
            }}
            onClick={() => setShowPicker(true)}
          >
            ✏️ Change
          </button>
        </div>
      ) : (
        <div>
          <select
            className="m-form-input"
            value={selectedCatId}
            onChange={(e) => setSelectedCatId(e.target.value)}
            style={{ marginBottom: 8 }}
          >
            <option value="">Select category…</option>
            {relevantCats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="m-btn-save"
              style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 15 }}
              onClick={handleChange}
              disabled={!selectedCatId || saving}
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              className="m-btn-cancel"
              style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 15 }}
              onClick={() => setShowPicker(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CategoryReview({ onReviewComplete }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/mobile/review');
      setQueue(res.data);
    } catch (e) {
      setError(e.message ?? 'Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeFromQueue = (id) =>
    setQueue((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0 && onReviewComplete) onReviewComplete();
      return next;
    });

  const handleConfirm = async (id, categoryId) => {
    await axios.patch(`/api/mobile/transactions/${id}/category`, {
      category_id: categoryId,
      confirm: true,
    });
    removeFromQueue(id);
  };

  const handleRecategorize = async (id, categoryId) => {
    await axios.patch(`/api/mobile/transactions/${id}/category`, {
      category_id: categoryId,
      confirm: false,
    });
    removeFromQueue(id);
  };

  const handleConfirmAll = async () => {
    setConfirmingAll(true);
    try {
      await axios.post('/api/mobile/review/confirm-all');
      setQueue([]);
      if (onReviewComplete) onReviewComplete();
    } catch (e) {
      setError(e.message);
    } finally {
      setConfirmingAll(false);
    }
  };

  if (loading) return <div className="m-loading">Loading review queue…</div>;
  if (error) return (
    <div className="m-error">
      {error}
      <button className="m-retry-btn" onClick={load}>Retry</button>
    </div>
  );

  if (queue.length === 0) {
    return (
      <div className="m-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>All caught up!</div>
        <div style={{ fontSize: 14, color: '#8e8e93' }}>
          No transactions need category review right now.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="m-card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {queue.length} transaction{queue.length !== 1 ? 's' : ''} to review
            </div>
            <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 2 }}>
              Confirm or correct the AI's category suggestions
            </div>
          </div>
          <button
            onClick={handleConfirmAll}
            disabled={confirmingAll}
            style={{
              background: '#34c759',
              color: 'white',
              border: 'none',
              borderRadius: 20,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {confirmingAll ? '…' : 'Confirm All'}
          </button>
        </div>
      </div>

      {/* Cards */}
      {queue.map((item) => (
        <ReviewCard
          key={item.id}
          item={item}
          onConfirm={handleConfirm}
          onRecategorize={handleRecategorize}
        />
      ))}
    </>
  );
}
