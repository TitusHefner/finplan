import React, { useState, useEffect, useCallback } from 'react';
import axios from '../api';

const GOAL_TYPES = [
  { value: 'savings',        label: '💰 Savings',        color: '#27ae60' },
  { value: 'debt_payoff',    label: '💳 Debt Payoff',    color: '#e74c3c' },
  { value: 'emergency_fund', label: '🛡️ Emergency Fund', color: '#f39c12' },
  { value: 'investment',     label: '📈 Investment',      color: '#8e44ad' },
  { value: 'purchase',       label: '🛒 Purchase',        color: '#2980b9' },
];

const PRIORITY_LABELS = { 1: 'Low', 2: 'Low-Med', 3: 'Medium', 4: 'High', 5: 'Critical' };

function fmt(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function goalTypeInfo(type) {
  return GOAL_TYPES.find(t => t.value === type) || { label: type, color: '#95a5a6' };
}

// ── Goal Form Modal ────────────────────────────────────────────────────────
function GoalForm({ initial, debtAccounts, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    goal_type: 'savings',
    target_amount: '',
    current_amount: '',
    target_date: '',
    description: '',
    priority: 3,
    plaid_account_id: '',
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isDebt = form.goal_type === 'debt_payoff';

  // When a debt account is selected, pre-fill target_amount from its balance
  function onDebtAccountChange(e) {
    const acctId = e.target.value;
    setForm(f => ({ ...f, plaid_account_id: acctId }));
    if (acctId) {
      const acct = debtAccounts.find(a => a.account_id === acctId);
      if (acct) {
        setForm(f => ({
          ...f,
          plaid_account_id: acctId,
          name: f.name || `Pay off ${acct.name}`,
          target_amount: acct.current_balance,
          current_amount: 0,
        }));
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        target_amount: parseFloat(form.target_amount),
        current_amount: parseFloat(form.current_amount) || 0,
        priority: parseInt(form.priority),
        plaid_account_id: form.plaid_account_id || null,
        target_date: form.target_date || null,
      };
      if (initial?.id) {
        await axios.patch(`/api/goals/${initial.id}`, payload);
      } else {
        await axios.post('/api/goals/', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save goal');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', color: '#2c3e50' }}>
          {initial?.id ? 'Edit Goal' : 'New Goal'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGrid}>
            <label style={styles.label}>Goal Name *
              <input style={styles.input} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required />
            </label>
            <label style={styles.label}>Type *
              <select style={styles.input} value={form.goal_type} onChange={e => setForm(f => ({...f, goal_type: e.target.value, plaid_account_id: ''}))}>
                {GOAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {isDebt && debtAccounts.length > 0 && (
              <label style={{...styles.label, gridColumn: '1 / -1'}}>Link to Plaid Debt Account
                <select style={styles.input} value={form.plaid_account_id} onChange={onDebtAccountChange}>
                  <option value=''>— Manual entry —</option>
                  {debtAccounts.map(a => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.institution_name} · {a.name} ({fmt(a.current_balance)} owed)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label style={styles.label}>Target Amount *
              <input style={styles.input} type='number' min='0.01' step='0.01' value={form.target_amount}
                onChange={e => setForm(f => ({...f, target_amount: e.target.value}))} required />
            </label>
            {!isDebt && (
              <label style={styles.label}>Current Amount
                <input style={styles.input} type='number' min='0' step='0.01' value={form.current_amount}
                  onChange={e => setForm(f => ({...f, current_amount: e.target.value}))} />
              </label>
            )}
            <label style={styles.label}>Target Date
              <input style={styles.input} type='date' value={form.target_date}
                onChange={e => setForm(f => ({...f, target_date: e.target.value}))} />
            </label>
            <label style={styles.label}>Priority
              <select style={styles.input} value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))}>
                {[1,2,3,4,5].map(p => <option key={p} value={p}>{p} — {PRIORITY_LABELS[p]}</option>)}
              </select>
            </label>
            <label style={{...styles.label, gridColumn: '1 / -1'}}>Description
              <textarea style={{...styles.input, minHeight: 64}} value={form.description}
                onChange={e => setForm(f => ({...f, description: e.target.value}))} />
            </label>
          </div>
          {error && <p style={{ color: '#e74c3c', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button type='button' style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type='submit' style={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save Goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Contribute Modal ───────────────────────────────────────────────────────
function ContributeModal({ goal, onSave, onClose }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post(`/api/goals/${goal.id}/contribute`, { amount: parseFloat(amount), notes });
      onSave();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to log contribution');
    } finally {
      setSaving(false);
    }
  }

  const remaining = goal.target_amount - goal.current_amount;
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{...styles.modal, maxWidth: 400}} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: '#2c3e50' }}>Log Contribution</h3>
        <p style={{ margin: '0 0 20px', color: '#7f8c8d', fontSize: 14 }}>{goal.name} · {fmt(remaining)} remaining</p>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Amount *
            <input style={styles.input} type='number' min='0.01' step='0.01' value={amount}
              onChange={e => setAmount(e.target.value)} required autoFocus />
          </label>
          <label style={styles.label}>Notes
            <input style={styles.input} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          {error && <p style={{ color: '#e74c3c', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button type='button' style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type='submit' style={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Goal Card ──────────────────────────────────────────────────────────────
function GoalCard({ goal, onContribute, onEdit, onDelete, onSync }) {
  const info = goalTypeInfo(goal.goal_type);
  const pct = goal.progress_pct || 0;
  const isDebt = goal.goal_type === 'debt_payoff';

  return (
    <div style={{...styles.card, borderTop: `4px solid ${info.color}`}}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600, color: info.color, textTransform: 'uppercase', letterSpacing: 1 }}>
            {info.label}
          </span>
          <h3 style={{ margin: '4px 0 0', color: '#2c3e50', fontSize: 18 }}>{goal.name}</h3>
        </div>
        <span style={{
          background: goal.is_completed ? '#27ae60' : pct >= 75 ? '#f39c12' : '#3498db',
          color: 'white', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600
        }}>
          {goal.is_completed ? '✓ Done' : `${pct}%`}
        </span>
      </div>

      {goal.description && (
        <p style={{ color: '#7f8c8d', fontSize: 13, margin: '0 0 12px' }}>{goal.description}</p>
      )}

      {/* Progress bar */}
      <div style={{ background: '#ecf0f1', borderRadius: 6, height: 10, marginBottom: 12, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: info.color,
          borderRadius: 6, transition: 'width 0.4s ease'
        }} />
      </div>

      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <span style={styles.statLabel}>{isDebt ? 'Paid Off' : 'Saved'}</span>
          <span style={styles.statValue}>{fmt(goal.current_amount)}</span>
        </div>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Target</span>
          <span style={styles.statValue}>{fmt(goal.target_amount)}</span>
        </div>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Remaining</span>
          <span style={{...styles.statValue, color: '#e74c3c'}}>
            {fmt(Math.max(goal.target_amount - goal.current_amount, 0))}
          </span>
        </div>
      </div>

      {(goal.target_date || goal.monthly_needed) && (
        <div style={{...styles.statsRow, marginTop: 8, borderTop: '1px solid #ecf0f1', paddingTop: 8}}>
          {goal.target_date && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Target Date</span>
              <span style={styles.statValue}>{new Date(goal.target_date).toLocaleDateString()}</span>
            </div>
          )}
          {goal.days_remaining != null && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Days Left</span>
              <span style={styles.statValue}>{goal.days_remaining}</span>
            </div>
          )}
          {goal.monthly_needed != null && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Monthly Needed</span>
              <span style={{...styles.statValue, color: '#8e44ad'}}>{fmt(goal.monthly_needed)}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {!goal.is_completed && (
          <button style={styles.btnSmallPrimary} onClick={() => onContribute(goal)}>+ Contribute</button>
        )}
        {goal.plaid_account_id && !goal.is_completed && (
          <button style={styles.btnSmallSecondary} onClick={() => onSync(goal.id)}>↻ Sync Plaid</button>
        )}
        <button style={styles.btnSmallSecondary} onClick={() => onEdit(goal)}>Edit</button>
        <button style={styles.btnSmallDanger} onClick={() => onDelete(goal.id)}>Delete</button>
      </div>
    </div>
  );
}

// ── Debt Account Card ──────────────────────────────────────────────────────
function DebtAccountCard({ acct, onCreateGoal, onEdit, onDelete }) {
  // Utilization only applies to credit cards
  const pct = acct.credit_limit && acct.current_balance != null
    ? Math.round((acct.current_balance / acct.credit_limit) * 100)
    : null;
  const utilizationColor = pct == null ? '#95a5a6' : pct >= 80 ? '#e74c3c' : pct >= 50 ? '#f39c12' : '#27ae60';
  const isOverdue = acct.is_overdue;

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div style={{...styles.card, borderTop: `4px solid ${isOverdue ? '#c0392b' : '#e74c3c'}`}}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#95a5a6', textTransform: 'uppercase', letterSpacing: 1 }}>
            {acct.institution_name} · {acct.subtype}
          </span>
          <h3 style={{ margin: '4px 0 0', color: '#2c3e50', fontSize: 17 }}>{acct.name}</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {isOverdue && (
            <span style={{ background: '#c0392b', color: 'white', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>OVERDUE</span>
          )}
          {pct != null && (
            <span style={{ background: utilizationColor, color: 'white', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
              {pct}% used
            </span>
          )}
        </div>
      </div>

      {pct != null && (
        <div style={{ background: '#ecf0f1', borderRadius: 6, height: 8, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: utilizationColor, borderRadius: 6 }} />
        </div>
      )}

      {/* Balance row */}
      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Balance Owed</span>
          <span style={{...styles.statValue, color: '#e74c3c'}}>{fmt(acct.current_balance)}</span>
        </div>
        {acct.credit_limit && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Credit Limit</span>
            <span style={styles.statValue}>{fmt(acct.credit_limit)}</span>
          </div>
        )}
        {acct.origination_principal_amount && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Original Amount</span>
            <span style={styles.statValue}>{fmt(acct.origination_principal_amount)}</span>
          </div>
        )}
      </div>

      {/* Payment details row */}
      <div style={{...styles.statsRow, marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 10}}>
        {acct.minimum_payment_amount != null && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Min Payment</span>
            <span style={{...styles.statValue, color: '#e67e22'}}>{fmt(acct.minimum_payment_amount)}</span>
          </div>
        )}
        {acct.next_payment_due_date && acct.next_payment_due_date !== '' && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Due Date</span>
            <span style={{...styles.statValue, color: isOverdue ? '#c0392b' : '#2c3e50'}}>{fmtDate(acct.next_payment_due_date)}</span>
          </div>
        )}
        {acct.last_payment_amount != null && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Last Payment</span>
            <span style={styles.statValue}>{fmt(acct.last_payment_amount)}</span>
          </div>
        )}
      </div>

      {/* APR / interest row */}
      {(acct.purchase_apr != null || acct.interest_rate_percentage != null || acct.interest_rate != null) && (
        <div style={{...styles.statsRow, marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 10}}>
          {acct.purchase_apr != null && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Purchase APR</span>
              <span style={{...styles.statValue, color: '#8e44ad'}}>{acct.purchase_apr}%</span>
            </div>
          )}
          {acct.interest_rate_percentage != null && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Interest Rate</span>
              <span style={{...styles.statValue, color: '#8e44ad'}}>{acct.interest_rate_percentage}%</span>
            </div>
          )}
          {acct.interest_rate != null && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Interest Rate</span>
              <span style={{...styles.statValue, color: '#8e44ad'}}>{acct.interest_rate}%</span>
            </div>
          )}
          {acct.outstanding_interest_amount != null && (
            <div style={styles.stat}>
              <span style={styles.statLabel}>Accrued Interest</span>
              <span style={{...styles.statValue, color: '#e74c3c'}}>{fmt(acct.outstanding_interest_amount)}</span>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={styles.btnSmallPrimary} onClick={() => onCreateGoal(acct)}>
          🎯 Create Payoff Goal
        </button>
        {onEdit && (
          <button style={styles.btnSmallSecondary} onClick={() => onEdit(acct)}>Edit</button>
        )}
        {onDelete && (
          <button style={styles.btnSmallDanger} onClick={() => onDelete(acct.id)}>Remove</button>
        )}
        {!acct.is_manual && (
          <span style={{ fontSize: 11, color: '#95a5a6', alignSelf: 'center' }}>🔗 Plaid</span>
        )}
      </div>
    </div>
  );
}

// ── Manual Debt Form Modal ────────────────────────────────────────────────
const DEBT_TYPES = [
  { value: 'credit_card',   label: '💳 Credit Card' },
  { value: 'student_loan',  label: '🎓 Student Loan' },
  { value: 'mortgage',      label: '🏠 Mortgage' },
  { value: 'personal_loan', label: '💵 Personal Loan' },
  { value: 'auto',          label: '🚗 Auto Loan' },
  { value: 'other',         label: '📋 Other' },
];

function ManualDebtForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    debt_type: 'credit_card',
    institution_name: '',
    current_balance: '',
    credit_limit: '',
    interest_rate: '',
    minimum_payment: '',
    next_payment_due_date: '',
    notes: '',
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isCard = form.debt_type === 'credit_card';

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        debt_type: form.debt_type,
        institution_name: form.institution_name || null,
        current_balance: parseFloat(form.current_balance),
        credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null,
        interest_rate: form.interest_rate ? parseFloat(form.interest_rate) : null,
        minimum_payment: form.minimum_payment ? parseFloat(form.minimum_payment) : null,
        next_payment_due_date: form.next_payment_due_date || null,
        notes: form.notes || null,
      };
      if (initial?.id) {
        await axios.patch(`/api/goals/manual-debts/${initial.id}`, payload);
      } else {
        await axios.post('/api/goals/manual-debts/', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', color: '#2c3e50' }}>
          {initial?.id ? 'Edit Debt Account' : 'Add Debt Account'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGrid}>
            <label style={styles.label}>Account Name *
              <input style={styles.input} value={form.name} onChange={e => set('name', e.target.value)} required />
            </label>
            <label style={styles.label}>Type *
              <select style={styles.input} value={form.debt_type} onChange={e => set('debt_type', e.target.value)}>
                {DEBT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label style={styles.label}>Institution / Lender
              <input style={styles.input} value={form.institution_name} onChange={e => set('institution_name', e.target.value)} placeholder='e.g. Navient, Chase' />
            </label>
            <label style={styles.label}>Current Balance *
              <input style={styles.input} type='number' min='0' step='0.01' value={form.current_balance}
                onChange={e => set('current_balance', e.target.value)} required />
            </label>
            {isCard && (
              <label style={styles.label}>Credit Limit
                <input style={styles.input} type='number' min='0' step='0.01' value={form.credit_limit}
                  onChange={e => set('credit_limit', e.target.value)} />
              </label>
            )}
            <label style={styles.label}>Interest Rate / APR (%)
              <input style={styles.input} type='number' min='0' step='0.01' value={form.interest_rate}
                onChange={e => set('interest_rate', e.target.value)} placeholder='e.g. 6.5' />
            </label>
            <label style={styles.label}>Minimum Payment
              <input style={styles.input} type='number' min='0' step='0.01' value={form.minimum_payment}
                onChange={e => set('minimum_payment', e.target.value)} />
            </label>
            <label style={styles.label}>Next Payment Due
              <input style={styles.input} type='date' value={form.next_payment_due_date}
                onChange={e => set('next_payment_due_date', e.target.value)} />
            </label>
            <label style={{...styles.label, gridColumn: '1 / -1'}}>Notes
              <textarea style={{...styles.input, minHeight: 56}} value={form.notes}
                onChange={e => set('notes', e.target.value)} />
            </label>
          </div>
          {error && <p style={{ color: '#e74c3c', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button type='button' style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type='submit' style={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Summary Banner ─────────────────────────────────────────────────────────
function SummaryBanner({ goals, allDebts }) {
  const active = goals.filter(g => !g.is_completed);
  const completed = goals.filter(g => g.is_completed);
  const totalDebt = allDebts.reduce((s, a) => s + (a.current_balance || 0), 0);
  const totalSavingsTarget = active.filter(g => g.goal_type !== 'debt_payoff').reduce((s, g) => s + g.target_amount, 0);
  const totalSaved = active.filter(g => g.goal_type !== 'debt_payoff').reduce((s, g) => s + g.current_amount, 0);

  return (
    <div style={styles.banner}>
      <div style={styles.bannerStat}>
        <span style={styles.bannerNum}>{active.length}</span>
        <span style={styles.bannerLabel}>Active Goals</span>
      </div>
      <div style={styles.bannerStat}>
        <span style={styles.bannerNum}>{completed.length}</span>
        <span style={styles.bannerLabel}>Completed</span>
      </div>
      <div style={styles.bannerStat}>
        <span style={{...styles.bannerNum, color: '#27ae60'}}>{fmt(totalSaved)}</span>
        <span style={styles.bannerLabel}>Total Saved</span>
      </div>
      <div style={styles.bannerStat}>
        <span style={{...styles.bannerNum, color: '#f39c12'}}>{fmt(totalSavingsTarget)}</span>
        <span style={styles.bannerLabel}>Savings Targets</span>
      </div>
      <div style={styles.bannerStat}>
        <span style={{...styles.bannerNum, color: '#e74c3c'}}>{fmt(totalDebt)}</span>
        <span style={styles.bannerLabel}>Total Debt ({allDebts.length} accounts)</span>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
function FinancialPlanning() {
  const [goals, setGoals] = useState([]);
  const [debtAccounts, setDebtAccounts] = useState([]);      // from Plaid
  const [manualDebts, setManualDebts] = useState([]);        // manually entered
  const [loading, setLoading] = useState(true);
  const [debtLoading, setDebtLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [editDebt, setEditDebt] = useState(null);
  const [contributeGoal, setContributeGoal] = useState(null);
  const [filter, setFilter] = useState('active'); // active | completed | all
  const [error, setError] = useState('');

  // All debts combined for summary
  const allDebts = [...debtAccounts, ...manualDebts];

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/goals/');
      setGoals(res.data);
    } catch {
      setError('Failed to load goals');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDebtAccounts = useCallback(async () => {
    setDebtLoading(true);
    try {
      const res = await axios.get('/api/plaid/liabilities');
      const credit = (res.data.credit || []).map(a => ({ ...a, kind: 'credit' }));
      const student = (res.data.student || []).map(a => ({ ...a, kind: 'student', subtype: 'student loan' }));
      const mortgage = (res.data.mortgage || []).map(a => ({ ...a, kind: 'mortgage', subtype: 'mortgage' }));
      setDebtAccounts([...credit, ...student, ...mortgage].filter(a => !a.error));
    } catch {
      // Plaid liabilities may not be configured — silently skip
    } finally {
      setDebtLoading(false);
    }
  }, []);

  const loadManualDebts = useCallback(async () => {
    try {
      const res = await axios.get('/api/goals/manual-debts/');
      setManualDebts(res.data);
    } catch {
      // silently skip
    }
  }, []);

  useEffect(() => {
    loadGoals();
    loadDebtAccounts();
    loadManualDebts();
  }, [loadGoals, loadDebtAccounts, loadManualDebts]);

  async function handleDelete(id) {
    if (!window.confirm('Delete this goal?')) return;
    try {
      await axios.delete(`/api/goals/${id}`);
      setGoals(g => g.filter(x => x.id !== id));
    } catch {
      setError('Failed to delete goal');
    }
  }

  async function handleSync(id) {
    try {
      const res = await axios.post(`/api/goals/${id}/sync-plaid`);
      setGoals(g => g.map(x => x.id === id ? res.data : x));
    } catch (err) {
      setError(err.response?.data?.detail || 'Plaid sync failed');
    }
  }

  function handleCreateGoalFromDebt(acct) {
    setEditGoal({
      goal_type: 'debt_payoff',
      plaid_account_id: acct.is_manual ? null : acct.account_id,
      name: `Pay off ${acct.name}`,
      target_amount: acct.current_balance,
      current_amount: 0,
    });
    setShowForm(true);
  }

  async function handleDeleteDebt(id) {
    if (!window.confirm('Remove this debt account?')) return;
    try {
      await axios.delete(`/api/goals/manual-debts/${id}`);
      setManualDebts(d => d.filter(x => x.id !== id));
    } catch {
      setError('Failed to delete debt account');
    }
  }

  const filteredGoals = goals.filter(g => {
    if (filter === 'active') return !g.is_completed;
    if (filter === 'completed') return g.is_completed;
    return true;
  });

  // Split debt goals and other goals for display
  const debtGoals = filteredGoals.filter(g => g.goal_type === 'debt_payoff');
  const otherGoals = filteredGoals.filter(g => g.goal_type !== 'debt_payoff');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🎯 Financial Planning</h1>
          <p style={styles.subtitle}>Track savings goals and manage your debt payoff plan</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={styles.btnSecondary} onClick={() => { setEditDebt(null); setShowDebtForm(true); }}>
            + Add Debt Account
          </button>
          <button style={styles.btnPrimary} onClick={() => { setEditGoal(null); setShowForm(true); }}>
            + New Goal
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
          <button style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b' }}
            onClick={() => setError('')}>✕</button>
        </div>
      )}

      <SummaryBanner goals={goals} allDebts={allDebts} />

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, margin: '24px 0 16px' }}>
        {['active', 'completed', 'all'].map(f => (
          <button key={f} style={filter === f ? styles.tabActive : styles.tab}
            onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* All Debt Accounts (Plaid + Manual) */}
      {!debtLoading && allDebts.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{...styles.sectionTitle, margin: 0}}>💳 Debt Accounts</h2>
            <button style={styles.btnSmallSecondary} onClick={() => { setEditDebt(null); setShowDebtForm(true); }}>+ Add Manually</button>
          </div>
          <p style={{ color: '#7f8c8d', fontSize: 13, marginBottom: 16 }}>
            Plaid-linked accounts update automatically. Manual accounts can be edited anytime.
          </p>
          <div style={styles.grid}>
            {allDebts.map(acct => (
              <DebtAccountCard
                key={acct.account_id}
                acct={acct}
                onCreateGoal={handleCreateGoalFromDebt}
                onEdit={acct.is_manual ? (a => { setEditDebt(a); setShowDebtForm(true); }) : null}
                onDelete={acct.is_manual ? handleDeleteDebt : null}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state for debts when none exist */}
      {!debtLoading && allDebts.length === 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={styles.sectionTitle}>💳 Debt Accounts</h2>
          <div style={{ background: 'white', borderRadius: 12, padding: '24px 20px', border: '2px dashed #ddd', textAlign: 'center' }}>
            <p style={{ color: '#7f8c8d', margin: '0 0 12px' }}>No debt accounts yet. Add credit cards, student loans, or other debts to track them.</p>
            <button style={styles.btnSmallPrimary} onClick={() => { setEditDebt(null); setShowDebtForm(true); }}>+ Add Debt Account</button>
          </div>
        </section>
      )}

      {/* Debt Payoff Goals */}
      {debtGoals.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={styles.sectionTitle}>💳 Debt Payoff Goals</h2>
          <div style={styles.grid}>
            {debtGoals.map(g => (
              <GoalCard key={g.id} goal={g}
                onContribute={setContributeGoal}
                onEdit={goal => { setEditGoal(goal); setShowForm(true); }}
                onDelete={handleDelete}
                onSync={handleSync} />
            ))}
          </div>
        </section>
      )}

      {/* Savings / Other Goals */}
      {otherGoals.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={styles.sectionTitle}>💰 Savings & Other Goals</h2>
          <div style={styles.grid}>
            {otherGoals.map(g => (
              <GoalCard key={g.id} goal={g}
                onContribute={setContributeGoal}
                onEdit={goal => { setEditGoal(goal); setShowForm(true); }}
                onDelete={handleDelete}
                onSync={handleSync} />
            ))}
          </div>
        </section>
      )}

      {!loading && filteredGoals.length === 0 && (
        <div style={styles.emptyState}>
          <p style={{ fontSize: 48 }}>🎯</p>
          <h3 style={{ color: '#2c3e50', margin: '8px 0 4px' }}>No goals yet</h3>
          <p style={{ color: '#7f8c8d' }}>Create your first goal to start tracking your progress.</p>
          <button style={{...styles.btnPrimary, marginTop: 16}} onClick={() => setShowForm(true)}>+ New Goal</button>
        </div>
      )}

      {showForm && (
        <GoalForm
          initial={editGoal}
          debtAccounts={debtAccounts}
          onSave={() => { setShowForm(false); setEditGoal(null); loadGoals(); }}
          onClose={() => { setShowForm(false); setEditGoal(null); }}
        />
      )}

      {showDebtForm && (
        <ManualDebtForm
          initial={editDebt}
          onSave={() => { setShowDebtForm(false); setEditDebt(null); loadManualDebts(); }}
          onClose={() => { setShowDebtForm(false); setEditDebt(null); }}
        />
      )}

      {contributeGoal && (
        <ContributeModal
          goal={contributeGoal}
          onSave={() => { setContributeGoal(null); loadGoals(); }}
          onClose={() => setContributeGoal(null)}
        />
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = {
  page: { padding: 24, maxWidth: 1300, margin: '0 auto', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  title: { margin: 0, color: '#2c3e50', fontSize: 28, fontWeight: 700 },
  subtitle: { margin: '4px 0 0', color: '#7f8c8d', fontSize: 14 },
  sectionTitle: { color: '#2c3e50', fontSize: 18, fontWeight: 600, margin: '0 0 12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 },
  card: { background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', border: '1px solid #e1e8ed' },
  statsRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  stat: { display: 'flex', flexDirection: 'column' },
  statLabel: { fontSize: 11, color: '#95a5a6', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 15, fontWeight: 600, color: '#2c3e50' },
  banner: { display: 'flex', gap: 0, background: 'white', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', overflow: 'hidden', border: '1px solid #e1e8ed' },
  bannerStat: { flex: 1, padding: '16px 20px', textAlign: 'center', borderRight: '1px solid #ecf0f1', display: 'flex', flexDirection: 'column', gap: 4 },
  bannerNum: { fontSize: 22, fontWeight: 700, color: '#2c3e50' },
  bannerLabel: { fontSize: 11, color: '#95a5a6', textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyState: { textAlign: 'center', padding: '60px 20px', color: '#95a5a6' },
  errorBanner: { background: '#fdf0ed', border: '1px solid #fadbd8', borderRadius: 8, padding: '10px 16px', color: '#c0392b', marginBottom: 16, display: 'flex', alignItems: 'center' },
  // Modals
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#555', fontWeight: 500 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  // Buttons
  btnPrimary: { background: '#3498db', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnSecondary: { background: '#ecf0f1', color: '#2c3e50', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnSmallPrimary: { background: '#3498db', color: 'white', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 },
  btnSmallSecondary: { background: '#ecf0f1', color: '#2c3e50', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 },
  btnSmallDanger: { background: '#fdf0ed', color: '#e74c3c', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 },
  tab: { padding: '7px 18px', borderRadius: 20, border: '1px solid #ddd', background: 'white', cursor: 'pointer', fontSize: 13, color: '#7f8c8d' },
  tabActive: { padding: '7px 18px', borderRadius: 20, border: '1px solid #3498db', background: '#3498db', cursor: 'pointer', fontSize: 13, color: 'white', fontWeight: 600 },
};

export default FinancialPlanning;
