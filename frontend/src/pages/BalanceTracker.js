import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from '../api';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, zoomPlugin);

export default function BalanceTracker() {
  const chartRef = useRef(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [projection, setProjection] = useState([]);
  const [days, setDays] = useState(90);
  const [estimationMethod, setEstimationMethod] = useState('budget');
  const [avgMonths, setAvgMonths] = useState(3);
  const [variableBreakdown, setVariableBreakdown] = useState([]);
  const [snapshotAmount, setSnapshotAmount] = useState('');
  const [snapshotDate, setSnapshotDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [plannedExpenses, setPlannedExpenses] = useState([]);
  const [peDesc, setPeDesc] = useState('');
  const [peAmount, setPeAmount] = useState('');
  const [peDate, setPeDate] = useState('');
  const [peSaving, setPeSaving] = useState(false);
  const [plannedIncomes, setPlannedIncomes] = useState([]);
  const [piDesc, setPiDesc] = useState('');
  const [piAmount, setPiAmount] = useState('');
  const [piDate, setPiDate] = useState('');
  const [piSaving, setPiSaving] = useState(false);
  const [dayBreakdown, setDayBreakdown] = useState([]);
  const [plaidBalances, setPlaidBalances] = useState([]);
  const [plaidHistory, setPlaidHistory] = useState([]);
  const [trackerAccountId, setTrackerAccountId] = useState(null);
  const [includeExtraDebtPaymentAmount, setIncludeExtraDebtPaymentAmount] = useState(true);
  const [extraDebtPaymentAmount, setExtraDebtPaymentAmount] = useState(0);
  const [extraDebtPaymentIsManualOverride, setExtraDebtPaymentIsManualOverride] = useState(false);
  const [safetyBuffer, setSafetyBuffer] = useState(
    () => parseFloat(localStorage.getItem('safetyBuffer') ?? '500')
  );
  const [bufferInput, setBufferInput] = useState(
    () => localStorage.getItem('safetyBuffer') ?? '500'
  );

  const applyBuffer = (e) => {
    e.preventDefault();
    const val = parseFloat(bufferInput);
    if (!isNaN(val) && val >= 0) {
      setSafetyBuffer(val);
      localStorage.setItem('safetyBuffer', String(val));
    }
  };

  const fetchCurrent = useCallback(() => {
    axios.get('/api/balance/current')
      .then(res => setCurrent(res.data))
      .catch(() => {});
  }, []);

  const fetchHistory = useCallback(() => {
    axios.get('/api/balance/history')
      .then(res => setHistory(res.data))
      .catch(() => {});
  }, []);

  const fetchProjection = useCallback(() => {
    const params = new URLSearchParams({
      days,
      estimation_method: estimationMethod,
      avg_months: avgMonths,
      from_snapshot: 'true',
    });
    axios.get(`/api/balance/projection?${params}`)
      .then(res => setProjection(res.data))
      .catch(() => {});
  }, [days, estimationMethod, avgMonths]);

  const fetchBreakdown = useCallback(() => {
    if (estimationMethod === 'none') { setVariableBreakdown([]); return; }
    const params = new URLSearchParams({
      estimation_method: estimationMethod,
      avg_months: avgMonths,
    });
    axios.get(`/api/balance/variable-spending?${params}`)
      .then(res => setVariableBreakdown(res.data))
      .catch(() => {});
  }, [estimationMethod, avgMonths]);

  const fetchPlanned = useCallback(() => {
    axios.get('/api/balance/planned-expenses')
      .then(res => setPlannedExpenses(res.data))
      .catch(() => {});
  }, []);

  const fetchPlannedIncomes = useCallback(() => {
    axios.get('/api/balance/planned-incomes')
      .then(res => setPlannedIncomes(res.data))
      .catch(() => {});
  }, []);

  const fetchDayBreakdown = useCallback(() => {
    const params = new URLSearchParams({
      days,
      estimation_method: estimationMethod,
      avg_months: avgMonths,
      from_snapshot: 'true',
    });
    axios.get(`/api/balance/projection-breakdown?${params}`)
      .then(res => setDayBreakdown(res.data))
      .catch(() => {});
  }, [days, estimationMethod, avgMonths]);

  const fetchPlaidBalances = useCallback(() => {
    axios.get('/api/plaid/balances')
      .then(res => {
        setPlaidBalances(res.data);
        // Refresh current balance and history — a new BalanceSnapshot may have been saved
        fetchCurrent();
        axios.get('/api/plaid/balance-history')
          .then(r => setPlaidHistory(r.data))
          .catch(() => {});
      })
      .catch(() => {});
  }, [fetchCurrent]);

  const fetchTrackerAccount = useCallback(() => {
    axios.get('/api/plaid/tracker-account')
      .then(res => setTrackerAccountId(res.data.plaid_account_id))
      .catch(() => {});
  }, []);

  const fetchDebtPlanForProjection = useCallback(async () => {
    try {
      const [manualRes, liabilitiesRes] = await Promise.all([
        axios.get('/api/goals/manual-debts/').catch(() => ({ data: [] })),
        axios.get('/api/plaid/liabilities').catch(() => ({ data: { credit: [], student: [], mortgage: [] } })),
      ]);

      const manualDebts = Array.isArray(manualRes.data) ? manualRes.data : [];
      const liabilities = liabilitiesRes.data || { credit: [], student: [], mortgage: [] };
      const debts = [];

      for (const d of manualDebts) {
        debts.push({
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
        debts.push({
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
        debts.push({
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

      const overrideRaw = localStorage.getItem('extraDebtPaymentAmountOverride');
      const overrideNum = overrideRaw != null && overrideRaw !== '' ? Number(overrideRaw) : null;

      const payload = {
        debts,
        extra_payment_budget: 0,
        lookback_days: 120,
        fixed_credit_card_name: 'AAdvantage',
        fixed_credit_card_autopay: 250,
        fixed_credit_card_extra: 750,
        student_strategy: 'avalanche',
        ignore_estimated_student_minimums: true,
        graduation_date: '2026-07-27',
        grace_period_months: 6,
        student_extra_override: overrideNum,
      };

      const res = await axios.post('/api/goals/debt-strategy', payload);
      const cp = res?.data?.custom_plan;
      setExtraDebtPaymentAmount(Number(cp?.student_extra_payment_used || 0));
      setExtraDebtPaymentIsManualOverride(Boolean(cp?.student_extra_is_manual_override));
    } catch {
      setExtraDebtPaymentAmount(0);
      setExtraDebtPaymentIsManualOverride(false);
    }
  }, []);

  const handleSetTrackerAccount = (plaidAccountId) => {
    axios.post('/api/plaid/tracker-account', { plaid_account_id: plaidAccountId })
      .then(() => {
        setTrackerAccountId(plaidAccountId);
        fetchPlaidBalances(); // triggers auto-snapshot + refreshes current balance
      })
      .catch(() => {});
  };

  const handleClearTrackerAccount = () => {
    axios.delete('/api/plaid/tracker-account')
      .then(() => setTrackerAccountId(null))
      .catch(() => {});
  };

  const fetchPlaidHistory = useCallback(() => {
    axios.get('/api/plaid/balance-history')
      .then(res => setPlaidHistory(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCurrent();
    fetchHistory();
    fetchPlanned();
    fetchPlannedIncomes();
    fetchPlaidBalances();
    fetchPlaidHistory();
    fetchTrackerAccount();
    fetchDebtPlanForProjection();
  }, [fetchCurrent, fetchHistory, fetchPlanned, fetchPlannedIncomes, fetchPlaidBalances, fetchPlaidHistory, fetchTrackerAccount, fetchDebtPlanForProjection]);

  useEffect(() => {
    fetchProjection();
    fetchDayBreakdown();
  }, [fetchProjection, fetchDayBreakdown]);

  useEffect(() => {
    fetchBreakdown();
  }, [fetchBreakdown]);

  const handleAddPlanned = (e) => {
    e.preventDefault();
    if (!peDesc || !peAmount || !peDate) return;
    setPeSaving(true);
    axios.post('/api/balance/planned-expenses', {
      description: peDesc,
      amount: parseFloat(peAmount),
      planned_date: `${peDate}T00:00:00`,
    })
      .then(() => {
        setPeDesc(''); setPeAmount(''); setPeDate('');
        fetchPlanned();
        fetchProjection();
        fetchDayBreakdown();
      })
      .finally(() => setPeSaving(false));
  };

  const handleDeletePlanned = (id) => {
    axios.delete(`/api/balance/planned-expenses/${id}`)
      .then(() => { fetchPlanned(); fetchProjection(); fetchDayBreakdown(); });
  };

  const handleAddPlannedIncome = (e) => {
    e.preventDefault();
    if (!piDesc || !piAmount || !piDate) return;
    setPiSaving(true);
    axios.post('/api/balance/planned-incomes', {
      description: piDesc,
      amount: parseFloat(piAmount),
      planned_date: `${piDate}T00:00:00`,
    })
      .then(() => {
        setPiDesc(''); setPiAmount(''); setPiDate('');
        fetchPlannedIncomes();
        fetchProjection();
        fetchDayBreakdown();
      })
      .finally(() => setPiSaving(false));
  };

  const handleDeletePlannedIncome = (id) => {
    axios.delete(`/api/balance/planned-incomes/${id}`)
      .then(() => { fetchPlannedIncomes(); fetchProjection(); fetchDayBreakdown(); });
  };

  const handleSetBalance = (e) => {
    e.preventDefault();
    if (!snapshotAmount) return;
    setSaving(true);
    setError('');
    const payload = { amount: parseFloat(snapshotAmount) };
    if (snapshotDate) payload.snapshot_date = `${snapshotDate}T00:00:00`;
    axios.post('/api/balance/snapshot', payload)
      .then(() => {
        setSnapshotAmount('');
        setSnapshotDate('');
        fetchCurrent();
        fetchHistory();
        fetchProjection();
        fetchBreakdown();
      })
      .catch(() => setError('Failed to save balance. Please try again.'))
      .finally(() => setSaving(false));
  };

  // Safety buffer analysis
  const fmt = (n) =>
    typeof n === 'number'
      ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      : '--';

  // Build unified chart axis: past (history) + future (projection)
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .substring(0, 10);

  const projectionAdjustment = useMemo(() => {
    const chargeDates = new Set();
    if (!includeExtraDebtPaymentAmount || extraDebtPaymentAmount <= 0 || projection.length === 0) {
      return { points: projection, chargeDates };
    }

    let runningAdjustment = 0;
    let lastChargedMonth = null;
    const adjusted = projection.map((p) => {
      const d = String(p.date || '');
      const monthKey = d.substring(0, 7);
      if (d > todayStr && monthKey !== lastChargedMonth) {
        runningAdjustment += Number(extraDebtPaymentAmount || 0);
        lastChargedMonth = monthKey;
        chargeDates.add(d);
      }
      return {
        ...p,
        balance: Math.round((Number(p.balance || 0) - runningAdjustment) * 100) / 100,
      };
    });

    return { points: adjusted, chargeDates };
  }, [projection, includeExtraDebtPaymentAmount, extraDebtPaymentAmount, todayStr]);

  const effectiveProjection = projectionAdjustment.points;

  const bufferBreaches = effectiveProjection.filter(p => p.balance < safetyBuffer);
  const firstBreach = bufferBreaches[0] ?? null;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = new Date(weekAgo.getTime() - weekAgo.getTimezoneOffset() * 60000)
    .toISOString()
    .substring(0, 10);
  const histMap = new Map(history.map(p => [p.date, p.balance]));
  const projMap = new Map(effectiveProjection.map(p => [p.date, p.balance]));
  const plaidMap = new Map(plaidHistory.map(p => [p.date, p.balance]));
  const allDates = [...new Set([
    ...history.map(p => p.date),
    ...effectiveProjection.map(p => p.date),
    ...plaidHistory.map(p => p.date),
  ])]
    .sort()
    .filter(d => d >= weekAgoStr);

  // Actual line: historical values only (null in future so line stops at today)
  const actualData = allDates.map(d => histMap.has(d) ? histMap.get(d) : null);
  // Projected line: all dates the projection API returns (including historical period
  // so both lines are visible simultaneously — actual vs projected comparison)
  const projData = allDates.map(d => projMap.has(d) ? projMap.get(d) : null);
  // Snapshot reference: flat line at snapshot amount, only over historical range
  const snapshotRef = current
    ? allDates.map(d => d <= todayStr ? current.snapshot_amount : null)
    : allDates.map(() => null);
  // Safety buffer + zero across full range
  const bufferLine = allDates.map(() => safetyBuffer);
  const zeroLine = allDates.map(() => 0);
  // Today marker: single point
  const todayMarker = allDates.map(d => d === todayStr ? (histMap.get(d) ?? projMap.get(d) ?? null) : null);

  // Day breakdown map for tooltip
  const dayBreakdownMap = new Map(dayBreakdown.map(d => [d.date, [...(d.items || [])]]));
  if (includeExtraDebtPaymentAmount && extraDebtPaymentAmount > 0) {
    for (const d of projectionAdjustment.chargeDates) {
      const items = dayBreakdownMap.get(d) || [];
      items.push({
        label: 'Extra debt payment amount',
        amount: -Math.abs(extraDebtPaymentAmount),
      });
      dayBreakdownMap.set(d, items);
    }
  }

  // Planned expense markers: large red dot at the projected balance on that date
  const plannedExpenseMap = new Map(
    plannedExpenses.map(pe => [
      pe.planned_date.substring(0, 10),
      pe,
    ])
  );
  const plannedMarkerData = allDates.map(d => {
    if (plannedExpenseMap.has(d) && projMap.has(d)) return projMap.get(d);
    return null;
  });

  // Planned income markers: large green dot at the projected balance on that date
  const plannedIncomeMap = new Map(
    plannedIncomes.map(pi => [
      pi.planned_date.substring(0, 10),
      pi,
    ])
  );
  const plannedIncomeMarkerData = allDates.map(d => {
    if (plannedIncomeMap.has(d) && projMap.has(d)) return projMap.get(d);
    return null;
  });

  const extraDebtPaymentMarkerData = allDates.map(d => {
    if (projectionAdjustment.chargeDates.has(d) && projMap.has(d)) return projMap.get(d);
    return null;
  });

  // Plaid history: real bank balance reconstructed from snapshots + transactions
  const plaidHistData = allDates.map(d => plaidMap.has(d) ? plaidMap.get(d) : null);

  const chartData = {
    labels: allDates,
    datasets: [
      // Delta fill: area between actual line and snapshot baseline
      {
        label: '_snapshotRef',
        data: snapshotRef,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 0,
        fill: false,
      },
      {
        label: 'Bank Balance (Plaid)',
        data: plaidHistData,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.08)',
        fill: false,
        tension: 0.15,
        pointRadius: allDates.map(d => plaidMap.has(d) ? 3 : 0),
        pointHoverRadius: 6,
        borderWidth: 2,
        borderDash: [3, 2],
        spanGaps: false,
      },
      {
        label: 'Actual Balance',
        data: actualData,
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.12)',
        fill: '-1', // fill to snapshotRef dataset = shows delta from starting balance
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2.5,
        spanGaps: false,
      },
      {
        label: 'Projected Balance',
        data: projData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        fill: 'origin',
        tension: 0,
        pointRadius: 0,
        borderWidth: 2,
        borderDash: [6, 4],
        spanGaps: false,
      },
      {
        label: `Safety Buffer (${fmt(safetyBuffer)})`,
        data: bufferLine,
        borderColor: 'rgba(249,115,22,0.8)',
        borderDash: [6, 4],
        pointRadius: 0,
        borderWidth: 1.5,
        fill: false,
        backgroundColor: 'transparent',
      },
      {
        label: 'Zero',
        data: zeroLine,
        borderColor: 'rgba(239,68,68,0.35)',
        borderDash: [3, 4],
        pointRadius: 0,
        borderWidth: 1,
        fill: false,
        backgroundColor: 'transparent',
      },
      {
        label: 'Today',
        data: todayMarker,
        borderColor: '#6366f1',
        backgroundColor: '#6366f1',
        pointRadius: allDates.map(d => d === todayStr ? 7 : 0),
        pointHoverRadius: 9,
        borderWidth: 0,
        fill: false,
        showLine: false,
      },
      {
        label: '_plannedExpenses',
        data: plannedMarkerData,
        borderColor: '#dc2626',
        backgroundColor: '#dc2626',
        pointRadius: allDates.map(d => plannedExpenseMap.has(d) && projMap.has(d) ? 10 : 0),
        pointHoverRadius: 12,
        pointStyle: 'triangle',
        rotation: 180,
        borderWidth: 0,
        fill: false,
        showLine: false,
      },
      {
        label: '_plannedIncomes',
        data: plannedIncomeMarkerData,
        borderColor: '#16a34a',
        backgroundColor: '#16a34a',
        pointRadius: allDates.map(d => plannedIncomeMap.has(d) && projMap.has(d) ? 10 : 0),
        pointHoverRadius: 12,
        pointStyle: 'triangle',
        rotation: 0,
        borderWidth: 0,
        fill: false,
        showLine: false,
      },
      {
        label: '_extraDebtPaymentAmount',
        data: extraDebtPaymentMarkerData,
        borderColor: '#7c2d12',
        backgroundColor: '#7c2d12',
        pointRadius: allDates.map(d => projectionAdjustment.chargeDates.has(d) && projMap.has(d) ? 8 : 0),
        pointHoverRadius: 10,
        pointStyle: 'rectRot',
        borderWidth: 0,
        fill: false,
        showLine: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          filter: item => !item.text.startsWith('_') && item.text !== 'Zero',
          boxWidth: 16,
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            if (ctx.dataset.label === 'Today') return `Today: ${fmt(ctx.parsed.y)}`;
            if (ctx.dataset.label === '_snapshotRef' || ctx.dataset.label === '_plannedExpenses' || ctx.dataset.label === '_plannedIncomes') return null;
            return `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`;
          },
          afterBody: (items) => {
            const date = items[0]?.label;
            if (!date) return [];
            const breakdown = dayBreakdownMap.get(date);
            if (!breakdown || breakdown.length === 0) return [];
            const lines = ['', '─────────────────────────'];
            for (const item of breakdown) {
              const sign = item.amount >= 0 ? '+' : '';
              const color = item.amount >= 0 ? '▲' : '▼';
              lines.push(`${color} ${item.label}: ${sign}${fmt(item.amount)}`);
            }
            return lines;
          },
        },
        filter: item => item.dataset.label !== '_snapshotRef' && item.dataset.label !== '_plannedExpenses' && item.dataset.label !== '_plannedIncomes' && item.parsed.y !== null,
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
          threshold: 5,
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: 'x',
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 12,
          font: { size: 11 },
        },
        grid: { color: 'rgba(0,0,0,0.04)' },
      },
      y: {
        ticks: { callback: val => `$${Number(val).toLocaleString()}` },
        grid: { color: 'rgba(0,0,0,0.06)' },
      },
    },
    interaction: { mode: 'index', intersect: false },
  };
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '8px' }}>💵 Balance Tracker</h2>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        Set your current balance, then see it updated automatically as you enter
        transactions and projected forward based on your recurring income &amp; fixed costs.
      </p>

      {/* Set Balance Form */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Set Starting Balance</h3>
        <form onSubmit={handleSetBalance} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Balance ($)</label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 5000.00"
              value={snapshotAmount}
              onChange={e => setSnapshotAmount(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>As of date (optional)</label>
            <input
              type="date"
              value={snapshotDate}
              onChange={e => setSnapshotDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button type="submit" disabled={saving} style={btnStyle}>
            {saving ? 'Saving…' : 'Save Balance'}
          </button>
        </form>
        {error && <p style={{ color: 'red', marginTop: '8px' }}>{error}</p>}
      </div>

      {/* Live Bank Balances (Plaid) */}
      {plaidBalances.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>🏦 Live Bank Balances</h3>
            <button
              onClick={fetchPlaidBalances}
              style={{ ...pillStyle, background: '#f3f4f6', color: '#374151', fontSize: 12 }}
            >
              ↺ Refresh
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {plaidBalances.map((acct, i) =>
              acct.error ? (
                <div key={i} style={{ padding: '12px 16px', background: '#fff2f2', borderRadius: 8, fontSize: 13, color: '#c0392b', minWidth: 200 }}>
                  <strong>{acct.institution_name ?? 'Bank'}</strong><br />
                  Error: {acct.error}
                </div>
              ) : (
                <div key={i} style={{
                  padding: '12px 16px',
                  background: acct.is_tracker_source ? '#f0fdf4' : '#f8fafc',
                  border: `1px solid ${acct.is_tracker_source ? '#16a34a' : '#e5e7eb'}`,
                  borderRadius: 8,
                  minWidth: 200,
                }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>
                    {acct.institution_name ?? 'Bank'} · {acct.subtype || acct.type}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
                    {acct.official_name || acct.name}
                    {acct.is_tracker_source && (
                      <span style={{ marginLeft: 6, fontSize: 11, background: '#dcfce7', color: '#16a34a', borderRadius: 10, padding: '1px 7px', fontWeight: 500 }}>
                        ✔ Balance source
                      </span>
                    )}
                  </div>
                  {acct.current != null && (
                    <div style={{ fontSize: 20, fontWeight: 700, color: acct.current >= 0 ? '#16a34a' : '#dc2626' }}>
                      {fmt(acct.current)}
                      <span style={{ fontSize: 11, fontWeight: 400, color: '#6b7280', marginLeft: 4 }}>current</span>
                    </div>
                  )}
                  {acct.available != null && acct.available !== acct.current && (
                    <div style={{ fontSize: 13, color: '#374151' }}>
                      {fmt(acct.available)}
                      <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>available</span>
                    </div>
                  )}
                  {acct.limit != null && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      Limit: {fmt(acct.limit)}
                    </div>
                  )}
                  {acct.last_updated_datetime && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      Updated: {new Date(acct.last_updated_datetime).toLocaleString()}
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    {acct.is_tracker_source ? (
                      <button
                        onClick={handleClearTrackerAccount}
                        style={{ fontSize: 12, border: '1px solid #dc2626', color: '#dc2626', background: 'none', borderRadius: 16, padding: '3px 10px', cursor: 'pointer' }}
                      >
                        Remove as source
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetTrackerAccount(acct.account_id)}
                        style={{ fontSize: 12, border: '1px solid #16a34a', color: '#16a34a', background: 'none', borderRadius: 16, padding: '3px 10px', cursor: 'pointer' }}
                      >
                        Use as balance source
                      </button>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, marginBottom: 0 }}>
            Balances are Plaid’s cached values and update approximately once daily while your account is active.
            {trackerAccountId && ' The active source account auto-updates the balance tracker on each refresh.'}
          </p>
        </div>
      )}

      {/* Current Balance Summary */}
      {current && (
        <div style={{ ...cardStyle, display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
          <Stat label="Current Balance" value={fmt(current.current_balance)}
                color={current.current_balance >= 0 ? '#16a34a' : '#dc2626'} />
          <Stat label="Starting Snapshot" value={fmt(current.snapshot_amount)} />
          <Stat label="Income Since Snapshot" value={fmt(current.total_income_since)} color="#16a34a" />
          <Stat label="Expenses Since Snapshot" value={fmt(current.total_expenses_since)} color="#dc2626" />
          <Stat label="Snapshot Date" value={current.snapshot_date
            ? new Date(current.snapshot_date).toLocaleDateString() : '--'} />
        </div>
      )}

      {/* Projection Chart */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ margin: 0 }}>Balance Projection</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>Show:</span>
            {[30, 60, 90, 180, 365].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  ...pillStyle,
                  background: days === d ? '#3b82f6' : '#f3f4f6',
                  color: days === d ? '#fff' : '#374151',
                }}
              >
                {d}d
              </button>
            ))}
            <div style={{ width: '1px', height: '20px', background: '#e5e7eb', margin: '0 4px' }} />
            <button
              onClick={() => chartRef.current?.resetZoom()}
              style={{ ...pillStyle, background: '#f3f4f6', color: '#374151', fontSize: '12px' }}
              title="Reset zoom to full range"
            >
              ↺ Reset zoom
            </button>
          </div>
        </div>

        {/* Estimation method controls */}
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Variable Spending Estimate
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <label style={labelStyle}>Method</label>
              <select
                value={estimationMethod}
                onChange={e => setEstimationMethod(e.target.value)}
                style={{ ...inputStyle, width: '200px' }}
              >
                <option value="avg_months">Average of last N months</option>
                <option value="prior_month">Prior month's actual</option>
                <option value="budget">Budgeted amount</option>
                <option value="none">Don't include variable spending</option>
              </select>
            </div>
            {estimationMethod === 'avg_months' && (
              <div>
                <label style={labelStyle}>Months to average</label>
                <select
                  value={avgMonths}
                  onChange={e => setAvgMonths(Number(e.target.value))}
                  style={{ ...inputStyle, width: '100px' }}
                >
                  {[1,2,3,4,5,6,9,12].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={includeExtraDebtPaymentAmount}
                onChange={e => setIncludeExtraDebtPaymentAmount(e.target.checked)}
              />
              Include extra debt payment amount in projection
            </label>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Amount: <strong>{fmt(extraDebtPaymentAmount)}</strong>
              {extraDebtPaymentIsManualOverride ? ' (manual override from Debt Command Center)' : ' (auto-calculated)'}
            </span>
          </div>
        </div>

        {allDates.length > 0 ? (
          <div style={{ position: 'relative', height: '460px' }}>
            <Line ref={chartRef} data={chartData} options={chartOptions} />
            {plannedExpenses.length > 0 && (
              <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: '11px', color: '#6b7280' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#dc2626', clipPath: 'polygon(50% 100%, 0 0, 100% 0)', marginRight: 4, verticalAlign: 'middle' }} />
                Planned expense
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: '#9ca3af', textAlign: 'center' }}>
            No projection data yet. Set a balance and add recurring income / fixed costs.
          </p>
        )}

        {allDates.length > 0 && effectiveProjection.length > 0 && (() => {
          const last = effectiveProjection[effectiveProjection.length - 1];
          const allPoints = [...history, ...projection];
          const low = effectiveProjection.length ? effectiveProjection.reduce((m, p) => p.balance < m.balance ? p : m, effectiveProjection[0]) : null;
          const negDays = effectiveProjection.filter(p => p.balance < 0);
          return (
            <>
              {firstBreach && (
                <div style={{
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginTop: '16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}>
                  <span style={{ fontSize: '20px' }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#9a3412', marginBottom: '2px' }}>
                      Balance drops below safety buffer on {firstBreach.date}
                    </div>
                    <div style={{ fontSize: '13px', color: '#c2410c' }}>
                      Projected balance {fmt(firstBreach.balance)} falls below your {fmt(safetyBuffer)} buffer.
                      {bufferBreaches.length > 1 && ` Stays below for ${bufferBreaches.length} day${bufferBreaches.length !== 1 ? 's' : ''}.`}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
                <Stat label={`Balance in ${days}d`} value={fmt(last.balance)}
                      color={last.balance >= 0 ? '#16a34a' : '#dc2626'} />
                <Stat label="Projected Low" value={`${fmt(low.balance)} on ${low.date}`}
                      color={low.balance < safetyBuffer ? '#ea580c' : '#374151'} />
                {includeExtraDebtPaymentAmount && extraDebtPaymentAmount > 0 && (
                  <Stat label="Extra Debt Payment Events" value={String(projectionAdjustment.chargeDates.size)} color="#7c2d12" />
                )}
                {bufferBreaches.length > 0 && (
                  <Stat label="⚠ Days Below Buffer" value={String(bufferBreaches.length)} color="#ea580c" />
                )}
                {negDays.length > 0 && (
                  <Stat label="⚠ Days Below Zero" value={String(negDays.length)} color="#dc2626" />
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* Safety Buffer Setting */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>🛡️ Safety Buffer</h3>
        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '12px' }}>
          Set a minimum balance threshold. You'll be warned on the chart and below if your projected balance is expected to drop below it.
        </p>
        <form onSubmit={applyBuffer} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Minimum Balance ($)</label>
            <input
              type="number"
              min="0"
              step="50"
              value={bufferInput}
              onChange={e => setBufferInput(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button type="submit" style={btnStyle}>Apply</button>
        </form>
        {safetyBuffer > 0 && (
          <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '10px', marginBottom: 0 }}>
            Current buffer: <strong>{fmt(safetyBuffer)}</strong> — shown as the orange dashed line on the chart.
          </p>
        )}
      </div>

      <p style={{ color: '#9ca3af', fontSize: '12px' }}>
        Projection combines recurring transactions (scheduled on exact dates) and estimated variable spending (spread daily).
        Actual transactions update your current balance automatically.
      </p>

      {/* Variable spending breakdown */}
      {variableBreakdown.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Variable Spending Included in Projection</h3>
          <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '12px' }}>
            These categories are estimated from your spending history and spread evenly across each day of the projection.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>Category</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Est. Monthly</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Est. Daily</th>
                <th style={thStyle}>Based on</th>
              </tr>
            </thead>
            <tbody>
              {variableBreakdown.map((est, i) => (
                <tr key={est.category_id ?? i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>{est.category_name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#dc2626' }}>
                    {fmt(est.monthly_estimate)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#9ca3af' }}>
                    {fmt(est.monthly_estimate / 30)}
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>
                    {est.estimation_method === 'budget' ? 'Budget'
                      : est.estimation_method === 'prior_month' ? 'Prior month'
                      : `Avg of ${est.months_of_data} month${est.months_of_data !== 1 ? 's' : ''}`}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f9fafb', fontWeight: 600 }}>
                <td style={tdStyle}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#dc2626' }}>
                  {fmt(variableBreakdown.reduce((s, e) => s + e.monthly_estimate, 0))}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#9ca3af' }}>
                  {fmt(variableBreakdown.reduce((s, e) => s + e.monthly_estimate / 30, 0))}
                </td>
                <td style={tdStyle} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Planned One-Time Expenses */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>📅 Planned One-Time Expenses</h3>        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '16px' }}>
          Add upcoming one-time costs (e.g. car repair, vacation) to see them reflected in the projected balance line.
        </p>
        <form onSubmit={handleAddPlanned} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' }}>
          <div>
            <label style={labelStyle}>Description</label>
            <input
              type="text"
              placeholder="e.g. Car repair"
              value={peDesc}
              onChange={e => setPeDesc(e.target.value)}
              required
              style={{ ...inputStyle, width: '200px' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Amount ($)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={peAmount}
              onChange={e => setPeAmount(e.target.value)}
              required
              style={{ ...inputStyle, width: '130px' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={peDate}
              onChange={e => setPeDate(e.target.value)}
              required
              style={{ ...inputStyle, width: '160px' }}
            />
          </div>
          <button type="submit" disabled={peSaving} style={btnStyle}>
            {peSaving ? 'Adding…' : 'Add'}
          </button>
        </form>
        {plannedExpenses.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>No planned expenses yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {plannedExpenses.map(pe => (
                <tr key={pe.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>{pe.description}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#dc2626' }}>{fmt(pe.amount)}</td>
                  <td style={tdStyle}>{new Date(pe.planned_date).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleDeletePlanned(pe.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', padding: '0 4px' }}
                      title="Remove"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Planned One-Time Income */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>💰 Planned One-Time Income</h3>
        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '16px' }}>
          Add expected one-time income events (e.g. bonus, tax refund, freelance payment) to see them reflected in the projected balance.
        </p>
        <form onSubmit={handleAddPlannedIncome} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' }}>
          <div>
            <label style={labelStyle}>Description</label>
            <input
              type="text"
              placeholder="e.g. Year-end bonus"
              value={piDesc}
              onChange={e => setPiDesc(e.target.value)}
              required
              style={{ ...inputStyle, width: '200px' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Amount ($)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={piAmount}
              onChange={e => setPiAmount(e.target.value)}
              required
              style={{ ...inputStyle, width: '130px' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={piDate}
              onChange={e => setPiDate(e.target.value)}
              required
              style={{ ...inputStyle, width: '160px' }}
            />
          </div>
          <button type="submit" disabled={piSaving} style={{ ...btnStyle, background: '#16a34a' }}>
            {piSaving ? 'Adding…' : 'Add'}
          </button>
        </form>
        {plannedIncomes.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>No planned income events yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {plannedIncomes.map(pi => (
                <tr key={pi.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>{pi.description}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#16a34a' }}>{fmt(pi.amount)}</td>
                  <td style={tdStyle}>{new Date(pi.planned_date).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleDeletePlannedIncome(pi.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', padding: '0 4px' }}
                      title="Remove"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = '#111827' }) {
  return (
    <div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

const cardStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '20px',
  marginBottom: '20px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};

const labelStyle = {
  display: 'block',
  fontSize: '12px',
  color: '#6b7280',
  marginBottom: '4px',
};

const inputStyle = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '14px',
  width: '180px',
};

const btnStyle = {
  padding: '8px 20px',
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
};

const pillStyle = {
  padding: '4px 12px',
  border: 'none',
  borderRadius: '20px',
  cursor: 'pointer',
  fontSize: '13px',
};

const thStyle = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: '12px',
  color: '#6b7280',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tdStyle = {
  padding: '8px 12px',
};
