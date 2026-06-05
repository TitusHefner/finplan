import React, { useState, useEffect } from 'react';
import axios from '../../api';

export default function AddTransactionModal({ onSave, onCancel }) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [txType, setTxType] = useState('expense');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState('monthly');
  const [recurringDay, setRecurringDay] = useState('');
  const [recurringStartDate, setRecurringStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      axios.get('/api/accounts/'),
      axios.get('/api/categories/'),
    ]).then(([accRes, catRes]) => {
      setAccounts(accRes.data);
      setCategories(catRes.data);
      if (accRes.data.length > 0) setAccountId(String(accRes.data[0].id));
    }).catch(() => {/* reference data optional; form still works */});
  }, []);

  const filteredCategories = categories.filter((c) =>
    txType === 'income' ? c.is_income : !c.is_income
  );

  const canSave = amount && !isNaN(Number(amount)) && description && accountId;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        account_id: Number(accountId),
        category_id: categoryId ? Number(categoryId) : null,
        amount: Number(amount),
        description,
        notes: null,
        transaction_type: txType,
        transaction_date: new Date(date).toISOString(),
        is_recurring: isRecurring,
        recurring_frequency: isRecurring ? recurringFrequency : null,
        recurring_day: isRecurring && recurringFrequency === 'monthly' && recurringDay ? Number(recurringDay) : null,
        recurring_start_date: isRecurring && ['weekly', 'bi-weekly'].includes(recurringFrequency) && recurringStartDate
          ? new Date(recurringStartDate).toISOString() : null,
        tags: null,
      };
      const res = await axios.post('/api/mobile/transactions', payload);
      onSave(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Close on overlay click
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const typeClasses = {
    expense: 'active-expense',
    income: 'active-income',
    transfer: 'active-transfer',
  };

  return (
    <div className="m-modal-overlay" onClick={handleOverlayClick}>
      <div className="m-modal">
        <div className="m-modal-handle" />
        <div className="m-modal-title">Add Transaction</div>

        <div className="m-form-section">
          <label className="m-form-label">Type</label>
          <div className="m-type-tabs">
            {['expense', 'income', 'transfer'].map((t) => (
              <button
                key={t}
                className={`m-type-tab ${txType === t ? typeClasses[t] : ''}`}
                onClick={() => { setTxType(t); setCategoryId(''); }}
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
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="m-form-section">
          <label className="m-form-label">Description</label>
          <input
            className="m-form-input"
            type="text"
            placeholder="What was this for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="m-form-section">
          <label className="m-form-label">Date</label>
          <input
            className="m-form-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {accounts.length > 0 && (
          <div className="m-form-section">
            <label className="m-form-label">Account</label>
            <select
              className="m-form-input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {filteredCategories.length > 0 && (
          <div className="m-form-section">
            <label className="m-form-label">Category (optional)</label>
            <select
              className="m-form-input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">None</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="m-form-error">{error}</div>}

        {/* Recurring */}
        <div className="m-form-section">
          <label className="m-form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={e => setIsRecurring(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Recurring transaction ↻
          </label>
        </div>

        {isRecurring && (
          <>
            <div className="m-form-section">
              <label className="m-form-label">Frequency</label>
              <select
                className="m-form-input"
                value={recurringFrequency}
                onChange={e => setRecurringFrequency(e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
                <option value="monthly">Monthly (calendar date)</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            {recurringFrequency === 'monthly' && (
              <div className="m-form-section">
                <label className="m-form-label">Day of month (e.g. 12 = 12th of every month)</label>
                <input
                  className="m-form-input"
                  type="number"
                  min="1"
                  max="31"
                  placeholder="1–31"
                  value={recurringDay}
                  onChange={e => setRecurringDay(e.target.value)}
                />
              </div>
            )}

            {['weekly', 'bi-weekly'].includes(recurringFrequency) && (
              <div className="m-form-section">
                <label className="m-form-label">Starts on (anchor date)</label>
                <input
                  className="m-form-input"
                  type="date"
                  value={recurringStartDate}
                  onChange={e => setRecurringStartDate(e.target.value)}
                />
              </div>
            )}
          </>
        )}

        <div className="m-modal-actions">
          <button className="m-btn-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="m-btn-save"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
