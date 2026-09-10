import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const FREQUENCIES = ['daily', 'weekly', 'bi-weekly', 'monthly', 'yearly'];

const FREQ_LABEL = {
  daily: 'Daily',
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const TYPE_LABEL = { income: 'Income', expense: 'Expense', transfer: 'Transfer' };

const EMPTY_NEW = {
  description: '',
  transaction_type: 'expense',
  amount: '',
  account_id: '',
  category_id: '',
  recurring_frequency: 'monthly',
  recurring_day: '',
  recurring_start_date: new Date().toISOString().substring(0, 10),
  recurring_end_date: '',
};

function nextMonthlyDate(dayOfMonth) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();

  const build = (y, m) => {
    const lastDay = new Date(y, m + 1, 0).getDate();
    const d = Math.min(dayOfMonth, lastDay);
    return new Date(y, m, d);
  };

  let candidate = build(year, month);
  // If today's date passed this month's recurring day, use next month.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (candidate < today) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    candidate = build(year, month);
  }

  return candidate;
}

export default function RecurringManager() {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // transaction id being edited
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newDraft, setNewDraft] = useState(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      axios.get('/api/transactions/recurring'),
      axios.get('/api/categories/'),
      axios.get('/api/accounts/'),
    ])
      .then(([txRes, catRes, accRes]) => {
        setTransactions(txRes.data);
        setCategories(catRes.data);
        setAccounts(accRes.data);
      })
      .catch(() => setError('Failed to load recurring transactions.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (tx) => {
    setEditing(tx.id);
    setDraft({
      amount: Math.abs(tx.amount),
      description: tx.description,
      category_id: tx.category_id ?? '',
      transaction_type: tx.transaction_type,
      recurring_frequency: tx.recurring_frequency ?? 'monthly',
      recurring_day: tx.recurring_day ?? '',
      recurring_start_date: tx.recurring_start_date
        ? tx.recurring_start_date.substring(0, 10)
        : '',
      recurring_end_date: tx.recurring_end_date
        ? tx.recurring_end_date.substring(0, 10)
        : '',
    });
    setError('');
  };

  const cancelEdit = () => { setEditing(null); setDraft({}); };

  const save = async (id) => {
    setSaving(true);
    setError('');
    try {
      const amount = parseFloat(draft.amount);
      if (isNaN(amount) || amount <= 0) { setError('Amount must be a positive number.'); setSaving(false); return; }

      const payload = {
        amount: draft.transaction_type === 'expense' ? -Math.abs(amount) : Math.abs(amount),
        description: draft.description,
        category_id: draft.category_id !== '' ? parseInt(draft.category_id) : null,
        transaction_type: draft.transaction_type,
        recurring_frequency: draft.recurring_frequency,
        recurring_day: draft.recurring_day !== '' ? parseInt(draft.recurring_day) : null,
        recurring_start_date: draft.recurring_start_date || null,
        recurring_end_date: draft.recurring_end_date || null,
      };

      await axios.patch(`/api/transactions/${id}`, payload);
      setEditing(null);
      setDraft({});
      load();
    } catch {
      setError('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const removeRecurring = async (id) => {
    if (!window.confirm('Remove recurring flag from this transaction?')) return;
    try {
      await axios.patch(`/api/transactions/${id}`, { is_recurring: false, recurring_frequency: null, recurring_day: null, recurring_start_date: null, recurring_end_date: null });
      setTransactions(t => t.filter(x => x.id !== id));
    } catch {
      setError('Failed to update transaction.');
    }
  };

  const addRecurring = async () => {
    setAdding(true);
    setAddError('');
    try {
      const amount = parseFloat(newDraft.amount);
      if (isNaN(amount) || amount <= 0) { setAddError('Amount must be a positive number.'); setAdding(false); return; }
      if (!newDraft.description.trim()) { setAddError('Description is required.'); setAdding(false); return; }
      if (!newDraft.account_id) { setAddError('Account is required.'); setAdding(false); return; }

      let anchorDate = new Date();
      if (['weekly', 'bi-weekly', 'yearly'].includes(newDraft.recurring_frequency) && newDraft.recurring_start_date) {
        anchorDate = new Date(newDraft.recurring_start_date);
      } else if (newDraft.recurring_frequency === 'monthly' && newDraft.recurring_day !== '') {
        anchorDate = nextMonthlyDate(parseInt(newDraft.recurring_day, 10));
      }

      if (Number.isNaN(anchorDate.getTime())) {
        setAddError('Invalid recurring start/schedule date.');
        setAdding(false);
        return;
      }

      const payload = {
        description: newDraft.description.trim(),
        amount: newDraft.transaction_type === 'expense' ? -Math.abs(amount) : Math.abs(amount),
        transaction_type: newDraft.transaction_type,
        account_id: parseInt(newDraft.account_id),
        category_id: newDraft.category_id !== '' ? parseInt(newDraft.category_id) : null,
        transaction_date: anchorDate.toISOString(),
        is_recurring: true,
        recurring_frequency: newDraft.recurring_frequency,
        recurring_day: newDraft.recurring_frequency === 'monthly' && newDraft.recurring_day !== ''
          ? parseInt(newDraft.recurring_day) : null,
        recurring_start_date: ['weekly', 'bi-weekly'].includes(newDraft.recurring_frequency) && newDraft.recurring_start_date
          ? new Date(newDraft.recurring_start_date).toISOString() : null,
        recurring_end_date: newDraft.recurring_end_date
          ? new Date(newDraft.recurring_end_date).toISOString() : null,
        notes: null,
        tags: null,
      };

      await axios.post('/api/transactions/', payload);
      setNewDraft(EMPTY_NEW);
      setShowAdd(false);
      load();
    } catch {
      setAddError('Failed to create recurring transaction.');
    } finally {
      setAdding(false);
    }
  };

  const grouped = FREQUENCIES.reduce((acc, f) => {
    acc[f] = transactions.filter(t => t.recurring_frequency === f);
    return acc;
  }, {});
  const ungrouped = transactions.filter(t => !t.recurring_frequency);

  const catName = (id) => categories.find(c => c.id === id)?.name ?? '—';

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>🔁 Recurring Transactions</h1>
        <button
          onClick={() => { setShowAdd(s => !s); setAddError(''); }}
          style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#2ecc71', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          {showAdd ? 'Cancel' : '+ Add Recurring'}
        </button>
      </div>
      <p style={{ color: '#888', marginBottom: 24 }}>
        Adjust amounts, descriptions, and schedule for your recurring income and expenses.
      </p>

      {showAdd && (
        <div style={{ background: '#f9fffe', border: '1px solid #b2dfdb', borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1a7a40' }}>New Recurring Transaction</h3>
          {addError && (
            <div style={{ background: '#fee', border: '1px solid #f88', borderRadius: 6, padding: '8px 12px', marginBottom: 12, color: '#c00', fontSize: 13 }}>
              {addError}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={lbl}>
              Description
              <input style={{ ...inp, minWidth: 180 }} value={newDraft.description}
                onChange={e => setNewDraft(d => ({ ...d, description: e.target.value }))} placeholder="e.g. Netflix" />
            </label>
            <label style={lbl}>
              Type
              <select style={inp} value={newDraft.transaction_type}
                onChange={e => setNewDraft(d => ({ ...d, transaction_type: e.target.value, category_id: '' }))}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>
            <label style={lbl}>
              Amount ($)
              <input style={{ ...inp, width: 100 }} type="number" min="0.01" step="0.01" value={newDraft.amount}
                onChange={e => setNewDraft(d => ({ ...d, amount: e.target.value }))} placeholder="0.00" />
            </label>
            <label style={lbl}>
              Account
              <select style={inp} value={newDraft.account_id}
                onChange={e => setNewDraft(d => ({ ...d, account_id: e.target.value }))}>
                <option value="">— Select —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label style={lbl}>
              Category
              <select style={inp} value={newDraft.category_id}
                onChange={e => setNewDraft(d => ({ ...d, category_id: e.target.value }))}>
                <option value="">— None —</option>
                {categories
                  .filter(c => newDraft.transaction_type === 'income' ? c.is_income : !c.is_income)
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label style={lbl}>
              Frequency
              <select style={inp} value={newDraft.recurring_frequency}
                onChange={e => setNewDraft(d => ({ ...d, recurring_frequency: e.target.value }))}>
                {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
              </select>
            </label>
            {newDraft.recurring_frequency === 'monthly' && (
              <label style={lbl}>
                Day of Month
                <input style={{ ...inp, width: 80 }} type="number" min="1" max="31" value={newDraft.recurring_day}
                  onChange={e => setNewDraft(d => ({ ...d, recurring_day: e.target.value }))} placeholder="e.g. 15" />
              </label>
            )}
            {['weekly', 'bi-weekly'].includes(newDraft.recurring_frequency) && (
              <label style={lbl}>
                Start Date
                <input style={inp} type="date" value={newDraft.recurring_start_date}
                  onChange={e => setNewDraft(d => ({ ...d, recurring_start_date: e.target.value }))} />
              </label>
            )}
            <label style={lbl}>
              End Date (optional)
              <input style={inp} type="date" value={newDraft.recurring_end_date}
                onChange={e => setNewDraft(d => ({ ...d, recurring_end_date: e.target.value }))} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={addRecurring} disabled={adding} style={btnSave}>{adding ? 'Saving…' : 'Add'}</button>
              <button onClick={() => { setShowAdd(false); setNewDraft(EMPTY_NEW); setAddError(''); }} style={btnCancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#fee', border: '1px solid #f88', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : transactions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔁</div>
          <p>No recurring transactions yet.</p>
          <p>Use <strong>+ Add Recurring</strong> above, or flag a transaction as recurring in the Transactions page.</p>
        </div>
      ) : (
        <>
          {[...FREQUENCIES, '__none__'].map(freq => {
            const group = freq === '__none__' ? ungrouped : grouped[freq];
            if (!group?.length) return null;
            return (
              <div key={freq} style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#555', marginBottom: 10 }}>
                  {freq === '__none__' ? 'No Frequency Set' : FREQ_LABEL[freq]}
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
                  <thead>
                    <tr style={{ background: '#f5f7fa', fontSize: 13 }}>
                      <th style={th}>Description</th>
                      <th style={th}>Type</th>
                      <th style={th}>Category</th>
                      <th style={th}>Amount</th>
                      <th style={th}>Schedule</th>
                      <th style={th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(tx => editing === tx.id ? (
                      <tr key={tx.id} style={{ background: '#fffbe6' }}>
                        <td style={td} colSpan={6}>
                          <EditRow
                            draft={draft}
                            setDraft={setDraft}
                            categories={categories}
                            onSave={() => save(tx.id)}
                            onCancel={cancelEdit}
                            saving={saving}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={tx.id} style={{ borderTop: '1px solid #eee', fontSize: 14 }}>
                        <td style={td}>{tx.description}</td>
                        <td style={td}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 12,
                            background: tx.transaction_type === 'income' ? '#e6f9ee' : tx.transaction_type === 'expense' ? '#feeaea' : '#eaf0fb',
                            color: tx.transaction_type === 'income' ? '#1a7a40' : tx.transaction_type === 'expense' ? '#c0392b' : '#2471a3',
                          }}>
                            {TYPE_LABEL[tx.transaction_type] ?? tx.transaction_type}
                          </span>
                        </td>
                        <td style={td}>{catName(tx.category_id)}</td>
                        <td style={{ ...td, fontWeight: 600, color: tx.transaction_type === 'income' ? '#1a7a40' : '#c0392b' }}>
                          {tx.transaction_type === 'income' ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                        </td>
                        <td style={{ ...td, color: '#888', fontSize: 13 }}>
                          {FREQ_LABEL[tx.recurring_frequency] ?? '—'}
                          {tx.recurring_frequency === 'monthly' && tx.recurring_day ? ` (day ${tx.recurring_day})` : ''}
                          {['weekly', 'bi-weekly'].includes(tx.recurring_frequency) && tx.recurring_start_date
                            ? ` from ${tx.recurring_start_date.substring(0, 10)}` : ''}
                          {tx.recurring_end_date
                            ? <span style={{ color: '#e67e22', marginLeft: 6 }}>ends {tx.recurring_end_date.substring(0, 10)}</span>
                            : null}
                        </td>
                        <td style={td}>
                          <button onClick={() => startEdit(tx)} style={btnEdit}>Edit</button>
                          <button onClick={() => removeRecurring(tx.id)} style={btnRemove}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function EditRow({ draft, setDraft, categories, onSave, onCancel, saving }) {
  const set = (key, val) => setDraft(d => ({ ...d, [key]: val }));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: '8px 0' }}>
      <label style={lbl}>
        Description
        <input style={inp} value={draft.description} onChange={e => set('description', e.target.value)} />
      </label>
      <label style={lbl}>
        Type
        <select style={inp} value={draft.transaction_type} onChange={e => set('transaction_type', e.target.value)}>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label style={lbl}>
        Amount ($)
        <input style={inp} type="number" min="0.01" step="0.01" value={draft.amount} onChange={e => set('amount', e.target.value)} />
      </label>
      <label style={lbl}>
        Category
        <select style={inp} value={draft.category_id} onChange={e => set('category_id', e.target.value)}>
          <option value="">— None —</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label style={lbl}>
        Frequency
        <select style={inp} value={draft.recurring_frequency} onChange={e => set('recurring_frequency', e.target.value)}>
          {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
        </select>
      </label>
      {draft.recurring_frequency === 'monthly' && (
        <label style={lbl}>
          Day of Month
          <input style={{ ...inp, width: 70 }} type="number" min="1" max="31" value={draft.recurring_day}
            onChange={e => set('recurring_day', e.target.value)} placeholder="e.g. 15" />
        </label>
      )}
      {['weekly', 'bi-weekly'].includes(draft.recurring_frequency) && (
        <label style={lbl}>
          Start Date
          <input style={inp} type="date" value={draft.recurring_start_date} onChange={e => set('recurring_start_date', e.target.value)} />
        </label>
      )}
      <label style={lbl}>
        End Date (optional)
        <input style={inp} type="date" value={draft.recurring_end_date} onChange={e => set('recurring_end_date', e.target.value)}
          placeholder="Last occurrence" />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={onSave} disabled={saving} style={btnSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} style={btnCancel}>Cancel</button>
      </div>
    </div>
  );
}

const th = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555' };
const td = { padding: '10px 12px', verticalAlign: 'middle' };
const btnEdit = { marginRight: 6, padding: '4px 12px', borderRadius: 5, border: '1px solid #3498db', background: '#eaf4fd', color: '#2471a3', cursor: 'pointer', fontSize: 13 };
const btnRemove = { padding: '4px 12px', borderRadius: 5, border: '1px solid #e74c3c', background: '#fdf0ef', color: '#c0392b', cursor: 'pointer', fontSize: 13 };
const btnSave = { padding: '6px 18px', borderRadius: 5, border: 'none', background: '#2ecc71', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnCancel = { padding: '6px 14px', borderRadius: 5, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' };
const lbl = { display: 'flex', flexDirection: 'column', fontSize: 12, color: '#666', gap: 4 };
const inp = { padding: '6px 8px', borderRadius: 5, border: '1px solid #ccc', fontSize: 14, minWidth: 120 };
