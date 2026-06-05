import React, { useState, useCallback, useEffect, useRef } from 'react';
import axios from '../../api';
import { TxRow } from './MobileDashboard';
import AddTransactionModal from './AddTransactionModal';

const PAGE_SIZE = 20;

const TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: '💚 Income', value: 'income' },
  { label: '🔴 Expense', value: 'expense' },
  { label: '🔵 Transfer', value: 'transfer' },
];

const TYPE_CLASSES = {
  expense: 'active-expense',
  income: 'active-income',
  transfer: 'active-transfer',
};

const EMPTY_FILTERS = {
  transaction_type: '',
  description: '',
  category_id: '',
  amount_min: '',
  amount_max: '',
  date_from: '',
  date_to: '',
};

function activeFilterCount(f) {
  return Object.values(f).filter(Boolean).length;
}

export default function MobileTransactions({ onTransactionAdded }) {
  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [descInput, setDescInput] = useState(''); // debounced into filters.description
  const [showFilters, setShowFilters] = useState(false);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  // Edit state
  const [editingTx, setEditingTx] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    axios.get('/api/categories/').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  // Debounce description text into filters
  const descTimer = useRef(null);
  useEffect(() => {
    clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, description: descInput }));
    }, 450);
    return () => clearTimeout(descTimer.current);
  }, [descInput]);

  const buildUrl = useCallback((currentSkip, f) => {
    const params = new URLSearchParams();
    params.set('skip', currentSkip);
    params.set('limit', PAGE_SIZE);
    if (f.transaction_type) params.set('transaction_type', f.transaction_type);
    if (f.description)      params.set('description', f.description);
    if (f.category_id)      params.set('category_id', f.category_id);
    if (f.amount_min)       params.set('amount_min', f.amount_min);
    if (f.amount_max)       params.set('amount_max', f.amount_max);
    if (f.date_from)        params.set('date_from', f.date_from);
    if (f.date_to)          params.set('date_to', f.date_to);
    return `/api/mobile/transactions?${params.toString()}`;
  }, []);

  const loadPage = useCallback(async (currentSkip, f, append) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(buildUrl(currentSkip, f));
      const rows = res.data;
      setTransactions((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
      setSkip(currentSkip + rows.length);
    } catch (e) {
      setError(e.message ?? 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  // Reload whenever any filter changes
  useEffect(() => {
    setTransactions([]);
    setSkip(0);
    setHasMore(true);
    loadPage(0, filters, false);
  }, [filters, loadPage]);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const clearFilters = () => {
    setDescInput('');
    setFilters(EMPTY_FILTERS);
  };

  const handleAdded = (newTx) => {
    setShowAdd(false);
    setTransactions((prev) => [newTx, ...prev]);
    if (onTransactionAdded) onTransactionAdded();
  };

  const startEdit = (tx) => {
    setEditDraft({
      transaction_type: tx.transaction_type?.toLowerCase() ?? 'expense',
      category_id: tx.category_id != null ? String(tx.category_id) : '',
      description: tx.description ?? '',
      amount: String(Math.abs(tx.amount)),
      is_recurring: tx.is_recurring ?? false,
      recurring_frequency: tx.recurring_frequency ?? 'monthly',
      recurring_day: tx.recurring_day != null ? String(tx.recurring_day) : '',
      recurring_start_date: tx.recurring_start_date
        ? tx.recurring_start_date.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    });
    setEditError(null);
    setEditingTx(tx);
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    setEditError(null);
    try {
      const txType = editDraft.transaction_type;
      const rawAmount = parseFloat(editDraft.amount);
      const signedAmount = txType === 'income' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
      const payload = {
        transaction_type: txType,
        category_id: editDraft.category_id !== '' ? parseInt(editDraft.category_id, 10) : null,
        description: editDraft.description,
        amount: signedAmount,
        is_recurring: editDraft.is_recurring,
        recurring_frequency: editDraft.is_recurring ? editDraft.recurring_frequency : null,
        recurring_day: editDraft.is_recurring && editDraft.recurring_frequency === 'monthly' && editDraft.recurring_day
          ? parseInt(editDraft.recurring_day, 10) : null,
        recurring_start_date: editDraft.is_recurring && ['weekly', 'bi-weekly'].includes(editDraft.recurring_frequency) && editDraft.recurring_start_date
          ? new Date(editDraft.recurring_start_date).toISOString() : null,
      };
      const res = await axios.patch(`/api/transactions/${editingTx.id}`, payload);
      const updatedCat = categories.find((c) => c.id === res.data.category_id);
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === editingTx.id
            ? { ...t, ...res.data, category_name: updatedCat?.name ?? t.category_name }
            : t
        )
      );
      setEditingTx(null);
    } catch (e) {
      setEditError(e.response?.data?.detail ?? e.message ?? 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteTx = async () => {
    if (!window.confirm(`Delete "${editingTx.description}"?`)) return;
    setDeletingId(editingTx.id);
    try {
      await axios.delete(`/api/transactions/${editingTx.id}`);
      setTransactions((prev) => prev.filter((t) => t.id !== editingTx.id));
      setEditingTx(null);
    } catch (e) {
      setEditError(e.response?.data?.detail ?? e.message ?? 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredCategories = categories.filter((c) =>
    editDraft.transaction_type === 'income' ? c.is_income : !c.is_income
  );

  const canSave =
    editDraft.amount && !isNaN(Number(editDraft.amount)) && editDraft.description;

  const numActive = activeFilterCount(filters);

  return (
    <>
      {/* Type chips + filter toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter('transaction_type', f.value)}
            style={{
              flexShrink: 0,
              padding: '6px 14px',
              borderRadius: 20,
              border: '1px solid',
              borderColor: filters.transaction_type === f.value ? '#007aff' : '#d1d1d6',
              background: filters.transaction_type === f.value ? '#007aff' : 'white',
              color: filters.transaction_type === f.value ? 'white' : '#8e8e93',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: filters.transaction_type === f.value ? 600 : 400,
            }}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => setShowFilters((v) => !v)}
          style={{
            flexShrink: 0,
            marginLeft: 'auto',
            padding: '6px 12px',
            borderRadius: 20,
            border: '1px solid',
            borderColor: numActive > 0 ? '#ff9500' : '#d1d1d6',
            background: numActive > 0 ? '#ff9500' : 'white',
            color: numActive > 0 ? 'white' : '#8e8e93',
            fontSize: 13,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          🔍 Filters{numActive > 0 ? ` (${numActive})` : ''}
        </button>
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="m-card" style={{ padding: '12px 14px', marginBottom: 10 }}>
          {/* Description */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5 }}>Description</label>
            <input
              className="m-form-input"
              type="text"
              placeholder="Search…"
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>

          {/* Category */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5 }}>Category</label>
            <select
              className="m-form-input"
              value={filters.category_id}
              onChange={(e) => setFilter('category_id', e.target.value)}
              style={{ marginTop: 4 }}
            >
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Amount range */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5 }}>Amount ($)</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                className="m-form-input"
                type="number"
                inputMode="decimal"
                placeholder="Min"
                value={filters.amount_min}
                onChange={(e) => setFilter('amount_min', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                className="m-form-input"
                type="number"
                inputMode="decimal"
                placeholder="Max"
                value={filters.amount_max}
                onChange={(e) => setFilter('amount_max', e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          {/* Date range */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5 }}>Date range</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                className="m-form-input"
                type="date"
                value={filters.date_from}
                onChange={(e) => setFilter('date_from', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                className="m-form-input"
                type="date"
                value={filters.date_to}
                onChange={(e) => setFilter('date_to', e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          {numActive > 0 && (
            <button
              onClick={clearFilters}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: 8,
                border: '1px solid #ff3b30',
                background: 'white',
                color: '#ff3b30',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      <div className="m-card" style={{ padding: '8px 16px' }}>
        {error && <div className="m-error" style={{ padding: '16px 0' }}>{error}</div>}
        {!error && transactions.length === 0 && !loading && (
          <div className="m-empty">No transactions found.</div>
        )}
        {transactions.map((tx) => (
          <div
            key={tx.id}
            onClick={() => startEdit(tx)}
            style={{ cursor: 'pointer' }}
          >
            <TxRow tx={tx} />
          </div>
        ))}
        {loading && <div className="m-loading" style={{ padding: '16px 0' }}>Loading…</div>}
      </div>

      {hasMore && !loading && (
        <div className="m-load-more">
          <button
            className="m-load-more-btn"
            onClick={() => loadPage(skip, filters, true)}
          >
            Load more
          </button>
        </div>
      )}

      {/* FAB */}
      <button className="m-fab" onClick={() => setShowAdd(true)} aria-label="Add transaction">
        +
      </button>

      {showAdd && (
        <AddTransactionModal
          onSave={handleAdded}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Edit modal */}
      {editingTx && (
        <div className="m-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditingTx(null); }}>
          <div className="m-modal">
            <div className="m-modal-handle" />
            <div className="m-modal-title">Edit Transaction</div>

            <div className="m-form-section">
              <label className="m-form-label">Type</label>
              <div className="m-type-tabs">
                {['expense', 'income', 'transfer'].map((t) => (
                  <button
                    key={t}
                    className={`m-type-tab ${editDraft.transaction_type === t ? TYPE_CLASSES[t] : ''}`}
                    onClick={() => setEditDraft((d) => ({ ...d, transaction_type: t, category_id: '' }))}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="m-form-section">
              <label className="m-form-label">Amount ($)</label>
              <input
                className="m-form-input"
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={editDraft.amount}
                onChange={(e) => setEditDraft((d) => ({ ...d, amount: e.target.value }))}
              />
            </div>

            <div className="m-form-section">
              <label className="m-form-label">Description</label>
              <input
                className="m-form-input"
                type="text"
                placeholder="What was this for?"
                value={editDraft.description}
                onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>

            {filteredCategories.length > 0 && (
              <div className="m-form-section">
                <label className="m-form-label">Category</label>
                <select
                  className="m-form-input"
                  value={editDraft.category_id}
                  onChange={(e) => setEditDraft((d) => ({ ...d, category_id: e.target.value }))}
                >
                  <option value="">None</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Recurring */}
            <div className="m-form-section">
              <label className="m-form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editDraft.is_recurring ?? false}
                  onChange={(e) => setEditDraft((d) => ({ ...d, is_recurring: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                Recurring transaction ↻
              </label>
            </div>

            {editDraft.is_recurring && (
              <>
                <div className="m-form-section">
                  <label className="m-form-label">Frequency</label>
                  <select
                    className="m-form-input"
                    value={editDraft.recurring_frequency}
                    onChange={(e) => setEditDraft((d) => ({ ...d, recurring_frequency: e.target.value }))}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly (calendar date)</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>

                {editDraft.recurring_frequency === 'monthly' && (
                  <div className="m-form-section">
                    <label className="m-form-label">Day of month (e.g. 12 = 12th of every month)</label>
                    <input
                      className="m-form-input"
                      type="number"
                      min="1"
                      max="31"
                      placeholder="1–31"
                      value={editDraft.recurring_day}
                      onChange={(e) => setEditDraft((d) => ({ ...d, recurring_day: e.target.value }))}
                    />
                  </div>
                )}

                {['weekly', 'bi-weekly'].includes(editDraft.recurring_frequency) && (
                  <div className="m-form-section">
                    <label className="m-form-label">Starts on (anchor date)</label>
                    <input
                      className="m-form-input"
                      type="date"
                      value={editDraft.recurring_start_date}
                      onChange={(e) => setEditDraft((d) => ({ ...d, recurring_start_date: e.target.value }))}
                    />
                  </div>
                )}
              </>
            )}

            {editError && <div className="m-form-error">{editError}</div>}

            <div className="m-modal-actions">
              <button
                className="m-btn-cancel"
                style={{ color: '#ff3b30' }}
                disabled={deletingId !== null}
                onClick={deleteTx}
              >
                {deletingId !== null ? 'Deleting…' : 'Delete'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="m-btn-cancel" onClick={() => setEditingTx(null)}>Cancel</button>
                <button
                  className="m-btn-save"
                  disabled={!canSave || savingEdit}
                  onClick={saveEdit}
                >
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
