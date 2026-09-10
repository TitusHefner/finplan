import React, { useState, useEffect, useCallback } from 'react';
import axios from '../api';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import './Dashboard.css';

ChartJS.register(
  ArcElement, CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Tooltip, Legend,
);

const fmt = (n) =>
  '$' + Math.abs(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const STATUS_COLOR = {
  ok:      { bar: '#27ae60', text: '#1e8449' },
  warning: { bar: '#f39c12', text: '#d68910' },
  over:    { bar: '#e74c3c', text: '#c0392b' },
};

// ── Sub-components ────────────────────────────────────────────────────────

function MonthNav({ year, month, onNavigate }) {
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const label = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long', year: 'numeric',
  });
  return (
    <div className="month-nav">
      <button className="month-btn" onClick={() => onNavigate(-1)}>‹</button>
      <div className="month-label-wrap">
        <span className="month-label">{label}</span>
        {!isCurrentMonth && (
          <button className="month-back-link" onClick={() => onNavigate(0)}>
            ← Current month
          </button>
        )}
      </div>
      <button
        className={`month-btn${isCurrentMonth ? ' disabled' : ''}`}
        onClick={() => !isCurrentMonth && onNavigate(1)}
      >›</button>
    </div>
  );
}

function SummaryCard({ title, value, sub, accent }) {
  return (
    <div className={`summary-card ${accent}`}>
      <div className="sc-title">{title}</div>
      <div className="sc-value">{value}</div>
      <div className="sc-sub">{sub}</div>
    </div>
  );
}

function BudgetBar({ b }) {
  const sc = STATUS_COLOR[b.status] || STATUS_COLOR.ok;
  const fill = Math.min(b.pct, 100);
  return (
    <div className="bbar-row" style={{ borderLeft: `4px solid ${sc.bar}` }}>
      <div className="bbar-header">
        <span className="bbar-name">
          {b.category_icon && <span>{b.category_icon} </span>}
          {b.name}
          {b.category_name && b.category_name !== b.name && (
            <span className="bbar-cat"> · {b.category_name}</span>
          )}
        </span>
        <span className="bbar-pct" style={{ color: sc.text }}>
          {b.pct > 999 ? '>999' : b.pct.toFixed(0)}%
        </span>
      </div>
      <div className="bbar-track">
        <div className="bbar-fill" style={{ width: `${fill}%`, background: sc.bar }} />
      </div>
      <div className="bbar-amounts">
        <span style={{ color: sc.text }}>{fmt(b.spent)} spent</span>
        <span className="bbar-of">of {fmt(b.budgeted)}</span>
        <span className="bbar-rem" style={{ color: b.status === 'over' ? sc.text : '#7f8c8d' }}>
          {b.status === 'over'
            ? `⚠ ${fmt(Math.abs(b.remaining))} over`
            : `${fmt(b.remaining)} left`}
        </span>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

function Dashboard() {
  const now = new Date();
  const [year, setYear]       = useState(now.getFullYear());
  const [month, setMonth]     = useState(now.getMonth() + 1);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState(null);
  const [debtPlan, setDebtPlan] = useState(null);

  // Savings balance editing
  const [editingSavings, setEditingSavings] = useState(false);
  const [savingsInput, setSavingsInput]     = useState('');
  const [savingsSaving, setSavingsSaving]   = useState(false);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    setActiveCat(null);
    setDebtPlan(null);
    try {
      const [summaryRes, manualRes, liabilitiesRes] = await Promise.all([
        axios.get(`/api/analytics/monthly-summary?year=${year}&month=${month}`),
        axios.get('/api/goals/manual-debts/').catch(() => ({ data: [] })),
        axios.get('/api/plaid/liabilities').catch(() => ({ data: { credit: [], student: [], mortgage: [] } })),
      ]);

      setData(summaryRes.data);

      const manualDebts = Array.isArray(manualRes.data) ? manualRes.data : [];
      const liabilities = liabilitiesRes.data || { credit: [], student: [], mortgage: [] };

      const strategyDebts = [];
      for (const d of manualDebts) {
        strategyDebts.push({
          name: d.name,
          debt_type: d.debt_type,
          current_balance: Math.abs(Number(d.current_balance || 0)),
          interest_rate: Number(d.interest_rate || 0),
          minimum_payment: d.minimum_payment_amount != null ? Number(d.minimum_payment_amount) : null,
          institution_name: d.institution_name || '',
          source: 'manual',
          next_payment_due_date: d.next_payment_due_date || null,
        });
      }
      for (const s of liabilities.student || []) {
        strategyDebts.push({
          name: s.name,
          debt_type: 'student_loan',
          current_balance: Math.abs(Number(s.current_balance || 0)),
          interest_rate: Number(s.interest_rate_percentage || 0),
          minimum_payment: s.minimum_payment_amount != null ? Number(s.minimum_payment_amount) : null,
          institution_name: s.institution_name || '',
          source: 'plaid',
          next_payment_due_date: s.next_payment_due_date || null,
        });
      }
      for (const c of liabilities.credit || []) {
        strategyDebts.push({
          name: c.name,
          debt_type: 'credit_card',
          current_balance: Math.abs(Number(c.current_balance || 0)),
          interest_rate: Number(c.purchase_apr || 0),
          minimum_payment: c.minimum_payment_amount != null ? Number(c.minimum_payment_amount) : null,
          institution_name: c.institution_name || '',
          source: 'plaid',
          next_payment_due_date: c.next_payment_due_date || null,
        });
      }

      const strategyPayload = {
        debts: strategyDebts,
        extra_payment_budget: 0,
        lookback_days: 120,
        fixed_credit_card_name: 'AAdvantage',
        fixed_credit_card_autopay: 250,
        fixed_credit_card_extra: 750,
        student_strategy: 'avalanche',
        ignore_estimated_student_minimums: true,
        graduation_date: '2026-05-15',
        grace_period_months: 6,
      };

      const strategyRes = await axios.post('/api/goals/debt-strategy', strategyPayload).catch(() => null);
      setDebtPlan(strategyRes?.data || null);
    } catch (e) {
      console.error('Monthly summary error:', e);
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const navigate = (dir) => {
    if (dir === 0) { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); return; }
    let m = month + dir, y = year;
    if (m < 1)  { m = 12; y--; }
    if (m > 12) { m = 1;  y++; }
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) return;
    setYear(y); setMonth(m);
  };

  const startEditSavings = () => {
    setSavingsInput(data?.savings_base?.toString() ?? '0');
    setEditingSavings(true);
  };

  const saveSavingsBase = async () => {
    const val = parseFloat(savingsInput);
    if (isNaN(val) || val < 0) return;
    setSavingsSaving(true);
    try {
      await axios.put('/api/settings/savings_base_balance', { value: val.toString() });
      await load();
      setEditingSavings(false);
    } finally {
      setSavingsSaving(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────
  const monthPct         = data ? Math.round((data.days_elapsed / data.days_in_month) * 100) : 0;
  const dailyAvg         = data && data.days_elapsed > 0 ? data.expenses / data.days_elapsed : 0;
  const totalBudgeted    = data ? data.budgets.reduce((s, b) => s + b.budgeted, 0) : 0;
  const totalBudgetSpent = data ? data.budgets.reduce((s, b) => s + b.spent,    0) : 0;

  // ── Doughnut chart ─────────────────────────────────────────────────
  const donutData = data && data.by_category.length > 0 ? {
    labels: data.by_category.map(c => c.category_name),
    datasets: [{
      data: data.by_category.map(c => c.amount),
      backgroundColor: data.by_category.map(c => c.color),
      borderColor: data.by_category.map((_, i) => activeCat === i ? '#2c3e50' : '#fff'),
      borderWidth: data.by_category.map((_, i) => activeCat === i ? 3 : 1),
      hoverOffset: 10,
    }],
  } : null;

  const donutOptions = {
    responsive: true,
    cutout: '68%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const c = data.by_category[ctx.dataIndex];
            return `  ${fmt(c.amount)} (${c.pct}%)`;
          },
        },
      },
    },
    onClick: (_, els) => {
      if (els.length) setActiveCat(v => els[0].index === v ? null : els[0].index);
    },
  };

  // ── Daily spending bar chart ───────────────────────────────────────
  const barData = data ? (() => {
    const days = data.daily_spending;
    const ds = [{
      label: 'Daily Spending',
      data: days,
      backgroundColor: days.map((_, i) => {
        const day = i + 1;
        if (!isCurrentMonth) return 'rgba(52,152,219,0.6)';
        return day < data.days_elapsed  ? 'rgba(52,152,219,0.85)'
             : day === data.days_elapsed ? '#2980b9'
             : 'rgba(52,152,219,0.25)';
      }),
      borderRadius: 4,
    }];
    if (isCurrentMonth && dailyAvg > 0) {
      ds.push({
        label: `Avg ${fmt(dailyAvg)}/day`,
        data: Array(data.days_in_month).fill(parseFloat(dailyAvg.toFixed(2))),
        type: 'line',
        borderColor: '#e74c3c',
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      });
    }
    return { labels: Array.from({ length: data.days_in_month }, (_, i) => i + 1), datasets: ds };
  })() : null;

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { display: isCurrentMonth && dailyAvg > 0, position: 'top', labels: { boxWidth: 14 } },
      tooltip: { callbacks: { label: (ctx) => `  ${fmt(ctx.raw)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() } },
    },
  };

  // ── Savings rate label ─────────────────────────────────────────────
  const rateLabel = (r) =>
    r >= 20 ? 'Excellent' : r >= 10 ? 'Good' : r >= 0 ? 'Needs work' : 'Over income';

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>📊 Monthly Budget Dashboard</h1>
        <MonthNav year={year} month={month} onNavigate={navigate} />
      </header>

      {loading && (
        <div className="dash-loading">
          <div className="dash-spinner" />
          <span>Loading…</span>
        </div>
      )}

      {!loading && !data && (
        <div className="dash-error">Could not load data — is the backend running?</div>
      )}

      {!loading && data && (
        <>
          {/* ── Month progress strip (current month only) ── */}
          {isCurrentMonth && (
            <div className="month-strip">
              <div className="month-strip-top">
                <span>Day {data.days_elapsed} of {data.days_in_month} — {monthPct}% through {data.month_name}</span>
              </div>
              <div className="month-track">
                <div className="month-fill" style={{ width: `${monthPct}%` }} />
              </div>
            </div>
          )}

          {/* ── Summary cards ── */}
          <div className="summary-cards">
            <SummaryCard
              title="Income"
              value={fmt(data.income)}
              sub={isCurrentMonth ? `${data.days_elapsed} days elapsed` : data.month_name}
              accent="sc-income"
            />
            <SummaryCard
              title="Expenses"
              value={fmt(data.expenses)}
              sub={`${data.by_category.length} categor${data.by_category.length === 1 ? 'y' : 'ies'}${data.transfers_excluded > 0 ? ` · ${data.transfers_excluded} transfer${data.transfers_excluded !== 1 ? 's' : ''} excluded` : ''}`}
              accent="sc-expenses"
            />
            <SummaryCard
              title="Saved This Month"
              value={fmt(data.savings_contributions)}
              sub={data.savings_breakdown?.map(s => `${s.icon} ${s.category_name}`).join(' · ') || 'No savings transfers'}
              accent="sc-savings"
            />
            <SummaryCard
              title="Savings Rate"
              value={`${data.savings_rate}%`}
              sub={rateLabel(data.savings_rate)}
              accent={
                data.savings_rate >= 20 ? 'sc-savings'
                : data.savings_rate >= 0 ? 'sc-warn'
                : 'sc-deficit'
              }
            />
          </div>

          <div className="dash-section dash-full">
            <h2 className="section-title">Debt Payoff At A Glance</h2>
            {!debtPlan ? (
              <div className="dash-empty">
                <div className="de-icon">📉</div>
                <p>Debt payoff timeline unavailable right now.</p>
              </div>
            ) : (
              <>
                <div className="debt-glance-grid">
                  <SummaryCard
                    title="Plan Debt-Free"
                    value={`M${debtPlan.custom_plan?.months_to_debt_free ?? '—'}`}
                    sub="Fixed AAdvantage + student strategy"
                    accent="sc-income"
                  />
                  <SummaryCard
                    title="Student X Used"
                    value={fmt(debtPlan.custom_plan?.student_extra_payment_used || 0)}
                    sub={debtPlan.custom_plan?.student_extra_is_manual_override ? 'Manual override' : 'Auto-calculated'}
                    accent="sc-savings"
                  />
                  <SummaryCard
                    title="Plan Interest"
                    value={fmt(debtPlan.custom_plan?.total_interest_paid || 0)}
                    sub="Projected total interest"
                    accent="sc-expenses"
                  />
                  <SummaryCard
                    title="Best Baseline"
                    value={(() => {
                      const rows = debtPlan.strategies || [];
                      if (!rows.length) return 'N/A';
                      const best = [...rows].sort((a, b) => a.months_to_debt_free - b.months_to_debt_free)[0];
                      return `${(best.strategy || '').toUpperCase()} M${best.months_to_debt_free}`;
                    })()}
                    sub="Across baseline strategies"
                    accent="sc-warn"
                  />
                </div>

                <div className="debt-order-preview">
                  <h3 className="section-title" style={{ marginBottom: 10 }}>Student Attack Order Preview</h3>
                  {(debtPlan.custom_plan?.student_attack_order || []).slice(0, 5).map((row, idx) => (
                    <div key={`${row.name}-${idx}`} className="debt-order-row">
                      <span>#{idx + 1} {row.name}</span>
                      <span>{row.in_grace_now ? 'Grace' : 'Repayment'} · APR {Number(row.apr || 0).toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Savings balance card ── */}
          <div className="savings-balance-card">
            <div className="sb-left">
              <div className="sb-icon">💰</div>
              <div>
                <div className="sb-label">Total Savings Balance</div>
                <div className="sb-breakdown">
                  Base {fmt(data.savings_base)}
                  {data.savings_contributions > 0 && (
                    <span> + {fmt(data.savings_contributions)} this month</span>
                  )}
                </div>
              </div>
            </div>
            <div className="sb-right">
              {editingSavings ? (
                <div className="sb-edit-wrap">
                  <span className="sb-dollar">$</span>
                  <input
                    className="sb-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={savingsInput}
                    onChange={e => setSavingsInput(e.target.value)}
                    autoFocus
                  />
                  <button className="sb-save-btn" onClick={saveSavingsBase} disabled={savingsSaving}>
                    {savingsSaving ? '…' : '✓'}
                  </button>
                  <button className="sb-cancel-btn" onClick={() => setEditingSavings(false)}>✕</button>
                </div>
              ) : (
                <div className="sb-total-wrap">
                  <div className="sb-total">{fmt(data.total_savings)}</div>
                  <button className="sb-edit-btn" onClick={startEditSavings} title="Set base savings balance">
                    ✏️ Set base
                  </button>
                </div>
              )}
            </div>
          </div>

          {data.transfers_excluded > 0 && (
            <div className="transfer-notice">
              🔁 <strong>{data.transfers_excluded}</strong> transfer transaction{data.transfers_excluded !== 1 ? 's' : ''} between
              your accounts {data.transfers_excluded !== 1 ? 'are' : 'is'} excluded from income and expense totals to prevent double-counting.
              <a href="/transactions" style={{ marginLeft: 8 }}>Manage transfers →</a>
            </div>
          )}

          {/* ── Two-column section: budgets + category donut ── */}
          <div className="dash-grid">

            {/* Budget progress */}
            <div className="dash-section">
              <h2 className="section-title">
                Budget Progress
                {data.budgets.length > 0 && (
                  <span className="section-badge">{data.budgets.length}</span>
                )}
              </h2>
              {data.budgets.length === 0 ? (
                <div className="dash-empty">
                  <div className="de-icon">🎯</div>
                  <p>No budgets for this period.</p>
                  <a href="/budgets">Create a budget →</a>
                </div>
              ) : (
                <div className="bbar-list">
                  {data.budgets.map(b => <BudgetBar key={b.id} b={b} />)}
                  {totalBudgeted > 0 && (
                    <div className="bbar-total">
                      <span>All budgets combined</span>
                      <span>
                        <strong>{fmt(totalBudgetSpent)}</strong>
                        <span className="bbar-of"> of {fmt(totalBudgeted)}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Category donut */}
            <div className="dash-section">
              <h2 className="section-title">Spending by Category</h2>
              {data.by_category.length === 0 ? (
                <div className="dash-empty">
                  <div className="de-icon">📊</div>
                  <p>No expense transactions this period.</p>
                </div>
              ) : (
                <div className="donut-layout">
                  <div className="donut-wrap">
                    <Doughnut data={donutData} options={donutOptions} />
                    <div className="donut-center">
                      {activeCat !== null && data.by_category[activeCat] ? (
                        <>
                          <div className="dc-name" style={{ color: data.by_category[activeCat].color }}>
                            {data.by_category[activeCat].icon} {data.by_category[activeCat].category_name}
                          </div>
                          <div className="dc-val">{fmt(data.by_category[activeCat].amount)}</div>
                          <div className="dc-pct">{data.by_category[activeCat].pct}% of expenses</div>
                        </>
                      ) : (
                        <>
                          <div className="dc-name">Total</div>
                          <div className="dc-val">{fmt(data.expenses)}</div>
                          <div className="dc-pct">all expenses</div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="cat-legend">
                    {data.by_category.map((c, i) => (
                      <div
                        key={i}
                        className={`cat-leg-row${activeCat === i ? ' active' : ''}`}
                        onClick={() => setActiveCat(v => v === i ? null : i)}
                      >
                        <span className="cat-dot" style={{ background: c.color }} />
                        <span className="cat-leg-name">{c.icon} {c.category_name}</span>
                        <span className="cat-leg-pct">{c.pct}%</span>
                        <span className="cat-leg-amt">{fmt(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Daily spending bar chart ── */}
          <div className="dash-section dash-full">
            <h2 className="section-title">
              Daily Spending — {data.month_name}
              {isCurrentMonth && dailyAvg > 0 && (
                <span className="section-badge">avg {fmt(dailyAvg)}/day</span>
              )}
            </h2>
            {data.daily_spending.every(v => v === 0) ? (
              <div className="dash-empty">
                <div className="de-icon">📅</div>
                <p>No spending data for this period.</p>
              </div>
            ) : (
              <div className="bar-wrap">
                <Bar data={barData} options={barOptions} />
              </div>
            )}
          </div>

          {/* ── Category breakdown table ── */}
          {data.by_category.length > 0 && (
            <div className="dash-section dash-full">
              <h2 className="section-title">Category Detail</h2>
              <div className="cat-table-wrap">
                <table className="cat-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="ta-r">Transactions</th>
                      <th className="ta-r">Spent</th>
                      <th className="ta-r">% of Total</th>
                      <th>Budget Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_category.map((c, i) => {
                      const matchBudget = data.budgets.find(b => b.category_id === c.category_id);
                      const sc = matchBudget ? STATUS_COLOR[matchBudget.status] : null;
                      return (
                        <tr
                          key={i}
                          className={activeCat === i ? 'row-active' : ''}
                          onClick={() => setActiveCat(v => v === i ? null : i)}
                        >
                          <td>
                            <span className="cat-dot-sm" style={{ background: c.color }} />
                            {c.icon} {c.category_name}
                          </td>
                          <td className="ta-r muted">{c.count}</td>
                          <td className="ta-r"><strong>{fmt(c.amount)}</strong></td>
                          <td className="ta-r">
                            <div className="inline-bar-wrap">
                              <div className="inline-bar" style={{ width: `${c.pct}%`, background: c.color }} />
                              <span>{c.pct}%</span>
                            </div>
                          </td>
                          <td>
                            {matchBudget ? (
                              <span className="status-pill" style={{ background: sc.bar + '22', color: sc.text }}>
                                {matchBudget.status === 'over'
                                  ? `⚠ Over by ${fmt(Math.abs(matchBudget.remaining))}`
                                  : matchBudget.status === 'warning'
                                  ? `⚡ ${fmt(matchBudget.remaining)} left`
                                  : `✓ ${fmt(matchBudget.remaining)} left`}
                              </span>
                            ) : (
                              <span className="muted">No budget</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Dashboard;