import React, { useState, useEffect, useCallback } from 'react';
import axios from '../api';

const PRESET_COLORS = [
  '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#e91e63', '#00bcd4',
];

const PRESET_ICONS = ['🍔', '🚗', '🎬', '💡', '🏥', '🛍️', '🏠', '📱', '✂️', '🎓', '✈️', '💼', '💰', '📈', '🏦', '❓'];

function CategoryRow({ cat, onDelete, onToggleSavings }) {
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm(`Delete category "${cat.name}"? Transactions assigned to it will become uncategorized.`)) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/categories/${cat.id}`);
      onDelete(cat.id);
    } catch {
      setDeleting(false);
    }
  };

  const handleToggleSavings = async () => {
    setToggling(true);
    try {
      const res = await axios.post(`/api/categories/${cat.id}/toggle-savings`);
      onToggleSavings(cat.id, res.data.is_savings);
    } catch {
      /* ignore */ 
    } finally {
      setToggling(false);
    }
  };

  return (
    <tr>
      <td>
        <span style={{ fontSize: 20 }}>{cat.icon ?? (cat.is_income ? '💰' : '💳')}</span>
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{cat.name}</span>
        </div>
      </td>
      <td>
        <span style={{
          padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: cat.is_income ? '#e8f8ee' : '#fef3e2',
          color: cat.is_income ? '#2ecc71' : '#f39c12',
        }}>
          {cat.is_income ? 'Income' : 'Expense'}
        </span>
        {cat.is_savings && (
          <span style={{
            marginLeft: 6, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: '#e8f8ee', color: '#1a6b38',
          }}>💰 Savings</span>
        )}
      </td>
      {!cat.is_income && (
        <td style={{ textAlign: 'center' }}>
          <button
            className={`btn btn-sm ${cat.is_savings ? 'btn-success' : 'btn-secondary'}`}
            onClick={handleToggleSavings}
            disabled={toggling}
            title={cat.is_savings ? 'Unmark as savings category' : 'Mark as savings — transfers to this category will add to savings balance instead of counting as expenses'}
            style={{
              fontSize: 12,
              padding: '3px 10px',
              background: cat.is_savings ? '#1a6b38' : undefined,
              color: cat.is_savings ? 'white' : undefined,
              borderColor: cat.is_savings ? '#1a6b38' : undefined,
            }}
          >
            {toggling ? '…' : cat.is_savings ? '💰 Savings' : '+💰 Savings'}
          </button>
        </td>
      )}
      {cat.is_income && <td />}
      <td style={{ textAlign: 'right' }}>
        <button
          className="btn btn-sm btn-danger"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

function AddCategoryForm({ onAdded }) {
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[0], icon: '', is_income: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await axios.post('/api/categories/', {
        name: form.name.trim(),
        color: form.color,
        icon: form.icon || null,
        is_income: form.is_income,
      });
      onAdded(res.data);
      setForm({ name: '', color: PRESET_COLORS[0], icon: '', is_income: false });
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to create category');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Name *</label>
        <input
          className="form-control"
          placeholder="e.g. Dining Out, Side Income…"
          value={form.name}
          onChange={e => set('name', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Type</label>
        <div style={{ display: 'flex', gap: 12 }}>
          {[false, true].map(isIncome => (
            <label key={String(isIncome)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={form.is_income === isIncome}
                onChange={() => set('is_income', isIncome)}
                style={{ accentColor: '#007aff' }}
              />
              {isIncome ? '💰 Income' : '💳 Expense'}
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => set('color', c)}
              style={{
                width: 28, height: 28, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                outline: form.color === c ? '3px solid #007aff' : '2px solid transparent',
                outlineOffset: 2,
              }}
            />
          ))}
          <input
            type="color"
            value={form.color}
            onChange={e => set('color', e.target.value)}
            style={{ width: 28, height: 28, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0 }}
            title="Custom color"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Icon (optional)</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {PRESET_ICONS.map(ic => (
            <button
              key={ic}
              type="button"
              onClick={() => set('icon', form.icon === ic ? '' : ic)}
              style={{
                fontSize: 20, background: 'none', border: '1px solid',
                borderColor: form.icon === ic ? '#007aff' : '#d1d1d6',
                borderRadius: 6, padding: '2px 6px', cursor: 'pointer',
              }}
            >
              {ic}
            </button>
          ))}
        </div>
        <input
          className="form-control"
          placeholder="Or type any emoji…"
          value={form.icon}
          onChange={e => set('icon', e.target.value)}
          style={{ maxWidth: 160 }}
        />
      </div>

      {error && <div style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}

      <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
        {saving ? 'Creating…' : '+ Add Category'}
      </button>
    </form>
  );
}

export default function CategoryManager() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/categories/');
      setCategories(res.data);
    } catch {
      setError('Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdded = (cat) => setCategories(prev => [...prev, cat]);
  const handleDelete = (id) => setCategories(prev => prev.filter(c => c.id !== id));
  const handleToggleSavings = (id, is_savings) =>
    setCategories(prev => prev.map(c => c.id === id ? { ...c, is_savings } : c));

  const expense = categories.filter(c => !c.is_income);
  const income = categories.filter(c => c.is_income);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>🏷️ Categories</h1>
        <p className="page-subtitle">Manage how your transactions are grouped and labeled.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem', alignItems: 'start' }}>

        {/* Add form */}
        <div className="card">
          <div className="card-header"><h2 className="card-title">New Category</h2></div>
          <div className="card-body">
            <AddCategoryForm onAdded={handleAdded} />
          </div>
        </div>

        {/* Category list */}
        <div>
          {loading && <div style={{ color: 'var(--text-secondary)', padding: 24 }}>Loading…</div>}
          {error && <div style={{ color: '#e74c3c', padding: 24 }}>{error}</div>}

          {!loading && !error && (
            <>
              {[{ label: '💳 Expense Categories', items: expense }, { label: '💰 Income Categories', items: income }].map(group => (
                <div className="card" key={group.label} style={{ marginBottom: '1.5rem' }}>
                  <div className="card-header"><h2 className="card-title">{group.label}</h2></div>
                  <div className="card-body" style={{ padding: 0 }}>
                    {group.items.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', padding: '1rem 1.5rem', margin: 0 }}>None yet.</p>
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: 40 }}>Icon</th>
                            <th>Name</th>
                            <th>Type</th>
                            <th style={{ textAlign: 'center' }}>Savings</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map(cat => (
                            <CategoryRow key={cat.id} cat={cat} onDelete={handleDelete} onToggleSavings={handleToggleSavings} />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
