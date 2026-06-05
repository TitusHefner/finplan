import React, { useState, useCallback, useEffect } from 'react';
import axios from '../../api';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const TX_ICONS = { income: '💚', expense: '🔴', transfer: '🔵' };

// ── Month navigation ──────────────────────────────────────────────────────

function MonthNav({ year, month, onNavigate }) {
  const now = new Date();
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
  const label = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long', year: 'numeric',
  });
  return (
    <div className="md-month-nav">
      <button className="md-nav-btn" onClick={() => onNavigate(-1)}>‹</button>
      <div className="md-nav-center">
        <div className="md-nav-label">{label}</div>
        {!isCurrent && (
          <button className="md-nav-today" onClick={() => onNavigate(0)}>← Today</button>
        )}
      </div>
      <button className="md-nav-btn" onClick={() => !isCurrent && onNavigate(1)}
        disabled={isCurrent} style={{ opacity: isCurrent ? 0.25 : 1 }}>›</button>
    </div>
  );
}

// ── Hero summary card ─────────────────────────────────────────────────────

function HeroCard({ data }) {
  const rate = data.savings_rate ?? 0;
  const rateColor = rate >= 20 ? '#34c759' : rate >= 0 ? '#ff9500' : '#ff3b30';
  const rateLabel = rate >= 20 ? 'Excellent' : rate >= 10 ? 'Good' : rate >= 0 ? 'Needs work' : 'Over income';

  return (
    <div className="md-hero-card">
      <div className="md-hero-kpi-row">
        <div className="md-kpi income">
          <div className="md-kpi-value">{fmt(data.income)}</div>
          <div className="md-kpi-label">↑ Income</div>
        </div>
        <div className="md-kpi-divider" />
        <div className="md-kpi expense">
          <div className="md-kpi-value">{fmt(data.expenses)}</div>
          <div className="md-kpi-label">↓ Expenses</div>
        </div>
        <div className="md-kpi-divider" />
        <div className="md-kpi saved">
          <div className="md-kpi-value" style={{ color: data.savings >= 0 ? '#34c759' : '#ff3b30' }}>
            {data.savings >= 0 ? fmt(data.savings) : `–${fmt(Math.abs(data.savings))}`}
          </div>
          <div className="md-kpi-label">{data.savings >= 0 ? '✓ Saved' : '⚠ Deficit'}</div>
        </div>
      </div>

      <div className="md-hero-rate-row">
        <div className="md-rate-track">
          <div className="md-rate-fill" style={{ width: `${Math.min(Math.max(rate, 0), 100)}%`, background: rateColor }} />
        </div>
        <div className="md-rate-label" style={{ color: rateColor }}>
          {rate.toFixed(1)}% savings rate · <span className="md-rate-grade">{rateLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ── Month progress ────────────────────────────────────────────────────────

function MonthProgressCard({ daysElapsed, daysInMonth, monthName }) {
  const pct = Math.round((daysElapsed / daysInMonth) * 100);
  return (
    <div className="m-card md-progress-card">
      <div className="md-progress-labels">
        <span>Day {daysElapsed} of {daysInMonth}</span>
        <span>{pct}% through {monthName}</span>
      </div>
      <div className="md-progress-track">
        <div className="md-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Doughnut + legend ─────────────────────────────────────────────────────

function CategoryDonutCard({ categories, totalExpenses }) {
  const [activeCat, setActiveCat] = useState(null);
  if (!categories || !categories.length) return null;

  const donutData = {
    labels: categories.map(c => c.category_name),
    datasets: [{
      data: categories.map(c => c.amount),
      backgroundColor: categories.map(c => c.color || '#8e8e93'),
      borderColor: categories.map((_, i) => activeCat === i ? '#fff' : 'rgba(255,255,255,0.6)'),
      borderWidth: categories.map((_, i) => activeCat === i ? 3 : 1.5),
      hoverOffset: 8,
    }],
  };

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: true,
    cutout: '65%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const c = categories[ctx.dataIndex];
            return ` ${fmt(c.amount)} (${c.pct}%)`;
          },
        },
      },
    },
    onClick: (_, els) => {
      if (els.length) setActiveCat(v => els[0].index === v ? null : els[0].index);
    },
  };

  const center = activeCat !== null && categories[activeCat]
    ? categories[activeCat]
    : null;

  return (
    <div className="m-card">
      <div className="m-card-title">Spending by Category</div>
      <div className="md-donut-layout">
        <div className="md-donut-wrap">
          <Doughnut data={donutData} options={donutOptions} />
          <div className="md-donut-center">
            {center ? (
              <>
                <div className="md-dc-icon">{center.icon}</div>
                <div className="md-dc-amt">{fmt(center.amount)}</div>
                <div className="md-dc-pct" style={{ color: center.color }}>{center.pct}%</div>
              </>
            ) : (
              <>
                <div className="md-dc-label">Total</div>
                <div className="md-dc-amt">{fmt(totalExpenses)}</div>
              </>
            )}
          </div>
        </div>
        <div className="md-cat-legend">
          {categories.map((c, i) => (
            <div
              key={i}
              className={`md-cat-row${activeCat === i ? ' active' : ''}`}
              onClick={() => setActiveCat(v => v === i ? null : i)}
            >
              <span className="md-cat-dot" style={{ background: c.color || '#8e8e93' }} />
              <span className="md-cat-name">{c.icon} {c.category_name}</span>
              <span className="md-cat-pct">{c.pct}%</span>
              <span className="md-cat-amt">{fmt(c.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Daily bar chart ───────────────────────────────────────────────────────

function DailyBarCard({ dailySpending, daysElapsed, monthName, isCurrentMonth }) {
  if (!dailySpending || dailySpending.every(v => v === 0)) return null;
  const totalDays = dailySpending.length;
  const avg = daysElapsed > 0
    ? dailySpending.slice(0, daysElapsed).reduce((s, v) => s + v, 0) / daysElapsed
    : 0;

  const barData = {
    labels: Array.from({ length: totalDays }, (_, i) => i + 1),
    datasets: [
      {
        label: 'Daily Spending',
        data: dailySpending,
        backgroundColor: dailySpending.map((_, i) => {
          const day = i + 1;
          if (!isCurrentMonth) return 'rgba(52,152,219,0.65)';
          return day < daysElapsed  ? 'rgba(52,152,219,0.8)'
               : day === daysElapsed ? '#2980b9'
               : 'rgba(52,152,219,0.18)';
        }),
        borderRadius: 3,
        borderSkipped: false,
      },
    ],
  };

  if (isCurrentMonth && avg > 0) {
    barData.datasets.push({
      type: 'line',
      label: `Avg ${fmt(avg)}/day`,
      data: Array(totalDays).fill(parseFloat(avg.toFixed(2))),
      borderColor: '#e74c3c',
      borderDash: [4, 3],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
    });
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: isCurrentMonth && avg > 0, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: 10 } },
      y: { beginAtZero: true, ticks: { callback: v => '$' + v, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
    },
  };

  return (
    <div className="m-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div className="m-card-title" style={{ margin: 0 }}>Daily Spending</div>
        {avg > 0 && <div style={{ fontSize: 12, color: '#8e8e93' }}>avg {fmt(avg)}/day</div>}
      </div>
      <div style={{ height: 140 }}>
        <Bar data={barData} options={barOptions} />
      </div>
    </div>
  );
}

// ── Budget progress ───────────────────────────────────────────────────────

function BudgetCard({ budgets }) {
  if (!budgets || !budgets.length) return null;
  const totalBudgeted = budgets.reduce((s, b) => s + b.budgeted, 0);
  const totalSpent    = budgets.reduce((s, b) => s + b.spent,    0);

  return (
    <div className="m-card">
      <div className="md-section-header">
        <div className="m-card-title" style={{ margin: 0 }}>Budget Progress</div>
        {totalBudgeted > 0 && (
          <div style={{ fontSize: 12, color: '#8e8e93' }}>
            {fmt(totalSpent)} <span style={{ opacity: 0.6 }}>of</span> {fmt(totalBudgeted)}
          </div>
        )}
      </div>
      {budgets.map((b) => {
        const fillPct = Math.min(b.pct, 100);
        const clr = b.status === 'over' ? '#ff3b30' : b.status === 'warning' ? '#ff9500' : '#34c759';
        return (
          <div key={b.id} className="md-bbar" style={{ borderLeftColor: clr }}>
            <div className="md-bbar-top">
              <span className="md-bbar-name">
                {b.category_icon ? `${b.category_icon} ` : ''}{b.name}
                {b.category_name && b.category_name !== b.name && (
                  <span className="md-bbar-cat"> · {b.category_name}</span>
                )}
              </span>
              <span className="md-bbar-pct" style={{ color: clr }}>
                {b.pct > 999 ? '>999' : b.pct.toFixed(0)}%
              </span>
            </div>
            <div className="md-bbar-track">
              <div className="md-bbar-fill" style={{ width: `${fillPct}%`, background: clr }} />
            </div>
            <div className="md-bbar-foot">
              <span style={{ color: clr }}>{fmt(b.spent)} spent</span>
              <span className="md-bbar-of">of {fmt(b.budgeted)}</span>
              <span style={{ color: b.status === 'over' ? '#ff3b30' : '#27ae60', fontWeight: 600 }}>
                {b.status === 'over'
                  ? `⚠ ${fmt(Math.abs(b.remaining))} over`
                  : `${fmt(b.remaining)} left`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Recent transactions ───────────────────────────────────────────────────

function TxRow({ tx }) {
  const type = tx.transaction_type;
  const prefix = type === 'expense' ? '-' : type === 'income' ? '+' : '';
  return (
    <div className="m-tx-row">
      <div className={`m-tx-icon ${type}`}>{TX_ICONS[type] ?? '💸'}</div>
      <div className="m-tx-info">
        <div className="m-tx-desc">{tx.description}</div>
        <div className="m-tx-meta">{tx.category_name ?? tx.account_name ?? type}</div>
      </div>
      <div className="m-tx-right">
        <div className={`m-tx-amount ${type}`}>{prefix}{fmt(Math.abs(tx.amount))}</div>
        <div className="m-tx-date">{fmtDate(tx.transaction_date)}</div>
      </div>
    </div>
  );
}

function RecentTxCard({ transactions }) {
  if (!transactions || !transactions.length) return null;
  return (
    <div className="m-card">
      <div className="m-card-title">Recent Transactions</div>
      {transactions.map((tx) => <TxRow key={tx.id} tx={tx} />)}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function MobileDashboard() {
  const now = new Date();
  const [year,  setYear]      = useState(now.getFullYear());
  const [month, setMonth]     = useState(now.getMonth() + 1);
  const [data,  setData]      = useState(null);
  const [txns,  setTxns]      = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, txRes] = await Promise.all([
        axios.get(`/api/analytics/monthly-summary?year=${year}&month=${month}`),
        isCurrentMonth
          ? axios.get('/api/mobile/transactions?limit=8')
          : Promise.resolve({ data: [] }),
      ]);
      setData(summaryRes.data);
      setTxns(txRes.data);
    } catch (e) {
      setError(e.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [year, month, isCurrentMonth]);

  useEffect(() => { load(); }, [load]);

  const navigate = (dir) => {
    if (dir === 0) { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); return; }
    let m = month + dir, y = year;
    if (m < 1)  { m = 12; y--; }
    if (m > 12) { m = 1;  y++; }
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) return;
    setYear(y); setMonth(m);
  };

  return (
    <div>
      <MonthNav year={year} month={month} onNavigate={navigate} />

      {loading && <div className="m-loading">Loading…</div>}
      {error && (
        <div className="m-error">
          {error}
          <button className="m-retry-btn" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && data && (
        <>
          <HeroCard data={data} />

          {isCurrentMonth && (
            <MonthProgressCard
              daysElapsed={data.days_elapsed}
              daysInMonth={data.days_in_month}
              monthName={data.month_name}
            />
          )}

          <CategoryDonutCard
            categories={data.by_category}
            totalExpenses={data.expenses}
          />

          <DailyBarCard
            dailySpending={data.daily_spending}
            daysElapsed={data.days_elapsed}
            monthName={data.month_name}
            isCurrentMonth={isCurrentMonth}
          />

          <BudgetCard budgets={data.budgets} />

          {isCurrentMonth && <RecentTxCard transactions={txns} />}
        </>
      )}
    </div>
  );
}

// Re-export helpers so other tabs can use them without circular deps
export { fmt, fmtDate, TxRow, TX_ICONS };
