import React, { useState, useCallback, useEffect } from 'react';
import axios from '../../api';
import { fmt } from './MobileDashboard';

function AddBudgetSheet({ onClose, onAdded }) {
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    axios.get('/api/categories/').then((r) => setCategories(r.data)).catch(() => {});
  }, []);
  const [form, setForm] = useState({ name: '', category_id: '', amount: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.amount) { setError('Name and amount are required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await axios.post('/api/budgets/', {
        name: form.name,
        category_id: form.category_id ? Number(form.category_id) : null,
        amount: parseFloat(form.amount),
        budget_type: 'monthly',
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

  const expenseCats = categories.filter((c) => !c.is_income);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: '#f2f2f7', borderRadius: '20px 20px 0 0', width: '100%', padding: '20px 16px 32px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>New Budget</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#8e8e93', cursor: 'pointer' }}>✕</button>
        </div>
        <form onSubmit={submit}>
          <label style={mS.label}>Budget name</label>
          <input style={mS.input} placeholder="e.g. Groceries" value={form.name} onChange={(e) => set('name', e.target.value)} />

          <label style={mS.label}>Category (optional)</label>
          <select style={mS.input} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">— No category —</option>
            {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <label style={mS.label}>Monthly limit ($)</label>
          <input style={mS.input} type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => set('amount', e.target.value)} />

          {error && <div style={{ color: '#ff3b30', fontSize: 13, margin: '8px 0' }}>{error}</div>}

          <button type="submit" disabled={saving} style={mS.btn}>
            {saving ? 'Creating…' : 'Create Budget'}
          </button>
        </form>
      </div>
    </div>
  );
}

const mS = {
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#6c6c70', marginBottom: 4, marginTop: 12 },
  input: { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d1d6', fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' },
  btn: { width: '100%', marginTop: 16, padding: '13px', background: '#007aff', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
};

export default function MobileBudgets() {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dashRes = await axios.get('/api/mobile/dashboard');
      setBudgets(dashRes.data.budget_overview);
    } catch (e) {
      setError(e.message ?? 'Failed to load budgets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdded = () => { setShowForm(false); load(); };

  const startEdit = (b) => { setEditingId(b.id); setEditAmount(String(b.amount)); };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (id) => {
    const amt = parseFloat(editAmount);
    if (!amt || isNaN(amt) || amt <= 0) return;
    setSavingEdit(true);
    try {
      await axios.put(`/api/budgets/${id}`, { amount: amt });
      setBudgets((prev) => prev.map((b) => b.id === id ? { ...b, amount: amt } : b));
      setEditingId(null);
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) return <div className="m-loading">Loading budgets…</div>;
  if (error) return (
    <div className="m-error">
      {error}
      <button className="m-retry-btn" onClick={load}>Retry</button>
    </div>
  );

  if (!budgets.length) return (
    <div className="m-empty" style={{ padding: 24, textAlign: 'center' }}>
      {showForm && <AddBudgetSheet onClose={() => setShowForm(false)} onAdded={handleAdded} />}
      <div style={{ fontSize: 48, marginBottom: 12 }}>🎯</div>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>No budgets yet</div>
      <div style={{ color: '#8e8e93', marginBottom: 20, fontSize: 14 }}>Set spending limits to stay on track.</div>
      <button className="m-add-btn" onClick={() => setShowForm(true)} style={{ background: '#007aff', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
        + Add Budget
      </button>
    </div>
  );

  const over    = budgets.filter((b) => b.status === 'over');
  const warning = budgets.filter((b) => b.status === 'warning');
  const onTrack = budgets.filter((b) => b.status === 'on_track');

  const groups = [
    { label: '🔴 Over budget', items: over },
    { label: '🟠 Approaching limit', items: warning },
    { label: '✅ On track', items: onTrack },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      {showForm && <AddBudgetSheet onClose={() => setShowForm(false)} onAdded={handleAdded} />}
      <div style={{ padding: '4px 0 12px', textAlign: 'right' }}>
        <button onClick={() => setShowForm(true)} style={{ background: '#007aff', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          + Add Budget
        </button>
      </div>
      {groups.map((group) => (
        <div className="m-card" key={group.label}>
          <div className="m-card-title">{group.label}</div>
          {group.items.map((b) => {
            const pct = Math.min(b.percentage_used, 100);
            return (
              <div className="m-budget-row" key={b.id}>
                <div className="m-budget-header">
                  <span className="m-budget-name">{b.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`m-budget-pct pct-${b.status}`}>
                      {b.percentage_used.toFixed(0)}%
                    </span>
                    <button
                      onClick={() => editingId === b.id ? cancelEdit() : startEdit(b)}
                      style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#007aff', padding: 0 }}
                    >
                      {editingId === b.id ? '✕' : '✏️'}
                    </button>
                  </div>
                </div>
                {editingId === b.id ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
                    <input
                      style={{ ...mS.input, flex: 1, fontSize: 14, padding: '7px 10px' }}
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="New limit"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(b.id)}
                      disabled={savingEdit}
                      style={{ background: '#007aff', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {savingEdit ? '…' : 'Save'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="m-budget-bar-bg">
                      <div
                        className={`m-budget-bar-fill bar-${b.status}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="m-budget-footer">
                      <span>
                        {fmt(b.spent)} of {fmt(b.amount)}
                      </span>
                      <span className={`m-budget-remaining ${b.status === 'over' ? 'over' : 'ok'}`}>
                        {b.status === 'over'
                          ? `${fmt(Math.abs(b.remaining))} over`
                          : `${fmt(b.remaining)} left`}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
