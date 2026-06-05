import React, { useState, useEffect, useCallback } from 'react';
import axios from '../api';

const fmt = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

function ProgressBar({ pct, status }) {
  const color = status === 'over' ? '#ff3b30' : status === 'warning' ? '#ff9500' : '#34c759';
  return (
    <div style={{ background: '#f0f0f5', borderRadius: 6, height: 8, overflow: 'hidden', margin: '8px 0' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 6, transition: 'width 0.4s' }} />
    </div>
  );
}

function BudgetCard({ budget, onDelete, onUpdated }) {
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const spent = budget.spent ?? 0;
  const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
  const status = pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok';
  const remaining = budget.amount - spent;

  const handleDelete = async () => {
    if (!window.confirm(`Delete budget "${budget.name}"?`)) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/budgets/${budget.id}`);
      onDelete(budget.id);
    } catch {
      setDeleting(false);
    }
  };

  const handleEdit = () => {
    setNewAmount(String(budget.amount));
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    const amt = parseFloat(newAmount);
    if (!amt || isNaN(amt) || amt <= 0) return;
    setSaving(true);
    try {
      const res = await axios.put(`/api/budgets/${budget.id}`, { amount: amt });
      onUpdated({ ...budget, amount: res.data.amount });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={S.budgetName}>{budget.name}</div>
          {budget.category_name && (
            <div style={S.budgetMeta}>{budget.category_name}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleEdit} style={{ ...S.deleteBtn, color: '#007aff', fontSize: 14 }}>✏️</button>
          <button onClick={handleDelete} disabled={deleting} style={S.deleteBtn}>
            {deleting ? '…' : '✕'}
          </button>
        </div>
      </div>

      {editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 4px' }}>
          <span style={{ fontSize: 13, color: '#3c3c43' }}>New monthly limit ($)</span>
          <input
            style={{ ...S.input, flex: 1, marginTop: 0 }}
            type="number"
            min="0.01"
            step="0.01"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            autoFocus
          />
          <button onClick={handleSaveEdit} disabled={saving} style={S.primaryBtn}>
            {saving ? '…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} style={S.secondaryBtn}>Cancel</button>
        </div>
      ) : (
        <>
          <ProgressBar pct={pct} status={status} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
            <span style={{ color: '#8e8e93' }}>{fmt(spent)} spent of {fmt(budget.amount)}</span>
            <span style={{ color: status === 'over' ? '#ff3b30' : status === 'warning' ? '#ff9500' : '#34c759', fontWeight: 600 }}>
              {status === 'over' ? `${fmt(Math.abs(remaining))} over` : `${fmt(remaining)} left`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function AddBudgetForm({ onAdded, onCancel }) {
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    axios.get('/api/categories/').then((r) => setCategories(r.data)).catch(() => {});
  }, []);
  const [form, setForm] = useState({
    name: '',
    category_id: '',
    amount: '',
    budget_type: 'monthly',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.amount) { setError('Name and amount are required.'); return; }
    setSaving(true);
    try {
      await axios.post('/api/budgets/', {
        name: form.name,
        category_id: form.category_id ? Number(form.category_id) : null,
        amount: parseFloat(form.amount),

        budget_type: form.budget_type,
      });
      onAdded();
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
          ? detail.map((d) => d.msg).join(', ')
          : 'Failed to create budget'
      );
      setSaving(false);
    }
  };

  const expenseCategories = categories.filter((c) => !c.is_income);

  return (
    <form onSubmit={handleSubmit} style={S.form}>
      <div style={S.formTitle}>New Budget</div>

      <label style={S.label}>Budget name *</label>
      <input
        style={S.input}
        placeholder="e.g. Groceries, Dining Out"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
      />

      <label style={S.label}>Category (optional)</label>
      <select style={S.input} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
        <option value="">— No category —</option>
        {expenseCategories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <label style={S.label}>Monthly limit *</label>
      <input
        style={S.input}
        type="number"
        min="0.01"
        step="0.01"
        placeholder="0.00"
        value={form.amount}
        onChange={(e) => set('amount', e.target.value)}
      />

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="submit" disabled={saving} style={S.primaryBtn}>
          {saving ? 'Creating…' : 'Create Budget'}
        </button>
        <button type="button" onClick={onCancel} style={S.secondaryBtn}>Cancel</button>
      </div>
    </form>
  );
}

export default function BudgetManager() {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [budgetsRes, dashRes] = await Promise.all([
        axios.get('/api/budgets/'),
        axios.get('/api/mobile/dashboard'),
      ]);
      const spentMap = Object.fromEntries(
        (dashRes.data.budget_overview || []).map((b) => [b.id, b.spent])
      );
      setBudgets(
        budgetsRes.data.map((b) => ({
          ...b,
          spent: spentMap[b.id] ?? 0,
        }))
      );
      setError('Failed to load budgets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (id) => setBudgets((prev) => prev.filter((b) => b.id !== id));
  const handleUpdated = (updated) => setBudgets((prev) => prev.map((b) => b.id === updated.id ? { ...b, ...updated } : b));
  const handleAdded = () => { setShowForm(false); load(); };

  const over    = budgets.filter((b) => (b.spent / b.amount) * 100 >= 100);
  const warning = budgets.filter((b) => { const p = (b.spent / b.amount) * 100; return p >= 80 && p < 100; });
  const onTrack = budgets.filter((b) => (b.spent / b.amount) * 100 < 80);

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Budgets</h1>
          <p style={S.subtitle}>Track your spending limits by category</p>
        </div>
        <button onClick={() => setShowForm(true)} style={S.primaryBtn}>+ New Budget</button>
      </div>

      {showForm && (
        <AddBudgetForm
          onAdded={handleAdded}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && <div style={{ color: '#8e8e93', padding: 24 }}>Loading budgets…</div>}
      {error && <div style={S.error}>{error}</div>}

      {!loading && !error && budgets.length === 0 && !showForm && (
        <div style={{ ...S.card, textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No budgets yet</div>
          <div style={{ color: '#8e8e93', marginBottom: 20 }}>Set spending limits to keep your finances on track.</div>
          <button onClick={() => setShowForm(true)} style={S.primaryBtn}>Create your first budget</button>
        </div>
      )}

      {over.length > 0 && (
        <div>
          <div style={S.groupLabel}>🔴 Over budget</div>
          {over.map((b) => <BudgetCard key={b.id} budget={b} onDelete={handleDelete} onUpdated={handleUpdated} />)}
        </div>
      )}
      {warning.length > 0 && (
        <div>
          <div style={S.groupLabel}>🟠 Approaching limit</div>
          {warning.map((b) => <BudgetCard key={b.id} budget={b} onDelete={handleDelete} onUpdated={handleUpdated} />)}
        </div>
      )}
      {onTrack.length > 0 && (
        <div>
          <div style={S.groupLabel}>✅ On track</div>
          {onTrack.map((b) => <BudgetCard key={b.id} budget={b} onDelete={handleDelete} onUpdated={handleUpdated} />)}
        </div>
      )}
    </div>
  );
}

const S = {
  page: { padding: '24px 32px', maxWidth: 720, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700, margin: 0 },
  subtitle: { color: '#8e8e93', margin: '4px 0 0' },
  groupLabel: { fontSize: 13, fontWeight: 600, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: 0.5, margin: '20px 0 8px' },
  card: {
    background: '#fff',
    borderRadius: 14,
    padding: '16px 20px',
    marginBottom: 10,
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
  },
  budgetName: { fontSize: 16, fontWeight: 600, color: '#1c1c1e' },
  budgetMeta: { fontSize: 13, color: '#8e8e93', marginTop: 2 },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#c7c7cc',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 4px',
    lineHeight: 1,
  },
  form: {
    background: '#fff',
    borderRadius: 14,
    padding: '20px 24px',
    marginBottom: 20,
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
  },
  formTitle: { fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#1c1c1e' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#3c3c43', marginBottom: 4, marginTop: 12 },
  input: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #d1d1d6',
    fontSize: 15,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
  },
  error: { color: '#ff3b30', fontSize: 13, marginTop: 8 },
  primaryBtn: {
    padding: '10px 20px',
    background: '#007aff',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 15,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 20px',
    background: 'none',
    color: '#8e8e93',
    border: '1px solid #d1d1d6',
    borderRadius: 10,
    fontSize: 15,
    cursor: 'pointer',
  },
};
