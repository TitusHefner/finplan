import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Doughnut, Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

const TAB_DEFS = [
  { id: 'overview', label: 'Debt Health' },
  { id: 'student', label: 'Student Loans' },
  { id: 'cards', label: 'Credit Cards' },
  { id: 'strategy', label: 'Strategy Lab' },
];

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function payoffDateFromNow(monthsToDebtFree) {
  const m = Number(monthsToDebtFree || 0);
  if (!Number.isFinite(m) || m <= 0) return 'Now';
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function normalizeManualDebt(d) {
  return {
    id: `manual-${d.id}`,
    name: d.name || 'Manual Debt',
    institution: d.institution_name || 'Manual',
    debtType: d.debt_type || 'other',
    balance: Math.abs(Number(d.current_balance || 0)),
    apr: Number(d.interest_rate || 0),
    minPayment: Number(d.minimum_payment_amount || 0),
    creditLimit: d.credit_limit != null ? Number(d.credit_limit) : null,
    dueDate: d.next_payment_due_date || null,
    source: 'manual',
  };
}

function normalizePlaidStudentDebt(d) {
  return {
    id: `plaid-student-${d.account_id}`,
    name: d.name || 'Student Loan',
    institution: d.institution_name || 'Plaid',
    debtType: 'student_loan',
    balance: Math.abs(Number(d.current_balance || 0)),
    apr: Number(d.interest_rate_percentage || 0),
    minPayment: Number(d.minimum_payment_amount || 0),
    creditLimit: null,
    dueDate: d.next_payment_due_date || null,
    source: 'plaid',
  };
}

function normalizePlaidCreditDebt(d) {
  return {
    id: `plaid-credit-${d.account_id}`,
    name: d.name || 'Credit Card',
    institution: d.institution_name || 'Plaid',
    debtType: 'credit_card',
    balance: Math.abs(Number(d.current_balance || 0)),
    apr: Number(d.purchase_apr || 0),
    minPayment: Number(d.minimum_payment_amount || 0),
    creditLimit: d.credit_limit != null ? Number(d.credit_limit) : null,
    dueDate: d.next_payment_due_date || null,
    source: 'plaid',
  };
}

function normalizePlaidDebtAccountFallback(d) {
  const type = String(d.type || '').toLowerCase();
  const subtype = String(d.subtype || '').toLowerCase();
  const isCredit = type === 'credit' || subtype.includes('credit');
  const isStudent = type === 'loan' && subtype.includes('student');

  if (isCredit) {
    return {
      account_id: d.account_id,
      name: d.name || d.official_name || 'Credit Card',
      institution_name: d.institution_name || 'Plaid',
      subtype: d.subtype || '',
      current_balance: Number(d.current_balance || 0),
      credit_limit: d.credit_limit != null ? Number(d.credit_limit) : null,
      available: null,
      currency: d.currency || 'USD',
      last_payment_amount: null,
      last_payment_date: '',
      last_statement_balance: null,
      last_statement_issue_date: '',
      minimum_payment_amount: null,
      next_payment_due_date: '',
      is_overdue: false,
      aprs: [],
      purchase_apr: null,
    };
  }

  if (isStudent) {
    return {
      account_id: d.account_id,
      name: d.name || d.official_name || 'Student Loan',
      institution_name: d.institution_name || 'Plaid',
      servicer_address: null,
      current_balance: Number(d.current_balance || 0),
      currency: d.currency || 'USD',
      interest_rate_percentage: null,
      minimum_payment_amount: null,
      next_payment_due_date: '',
      origination_principal_amount: null,
      outstanding_interest_amount: null,
      last_payment_amount: null,
      last_payment_date: '',
      is_overdue: false,
      repayment_plan: '',
      expected_payoff_date: '',
    };
  }

  return null;
}

function estimateMinPayment(debt) {
  if (debt.minPayment && debt.minPayment > 0) return debt.minPayment;
  if (debt.debtType === 'credit_card') return Math.max(35, debt.balance * 0.025);
  if (debt.debtType === 'student_loan') return Math.max(50, debt.balance * 0.012);
  return Math.max(40, debt.balance * 0.02);
}

function buildPayoffTimeline(debts, extraPayment) {
  const rows = debts
    .filter(d => d.balance > 0)
    .map(d => ({
      ...d,
      remaining: d.balance,
      apr: Math.max(Number(d.apr || 0), 0),
      minPay: estimateMinPayment(d),
    }));

  if (!rows.length) return [];

  const out = [];
  let month = 0;
  const MAX_MONTHS = 360;

  while (month <= MAX_MONTHS) {
    const totalRemaining = rows.reduce((s, d) => s + d.remaining, 0);
    const totalInterestRateWeight = rows.reduce((s, d) => s + (d.remaining * d.apr), 0);
    const weightedApr = totalRemaining > 0 ? totalInterestRateWeight / totalRemaining : 0;

    out.push({
      month,
      balance: Math.max(totalRemaining, 0),
      weightedApr,
    });

    if (totalRemaining <= 0.01) break;

    for (const d of rows) {
      if (d.remaining <= 0) continue;
      const monthlyRate = d.apr / 1200;
      d.remaining += d.remaining * monthlyRate;
    }

    let paymentPool = rows.reduce((s, d) => s + Math.min(d.minPay, d.remaining), 0) + Math.max(extraPayment, 0);

    const sorted = [...rows].sort((a, b) => {
      if (b.apr !== a.apr) return b.apr - a.apr;
      return b.remaining - a.remaining;
    });

    for (const d of sorted) {
      if (paymentPool <= 0 || d.remaining <= 0) continue;
      const pay = Math.min(d.remaining, paymentPool);
      d.remaining -= pay;
      paymentPool -= pay;
    }

    month += 1;
  }

  return out;
}

function DebtCard({ debt }) {
  const util = debt.creditLimit && debt.creditLimit > 0
    ? (debt.balance / debt.creditLimit) * 100
    : null;
  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={styles.subtle}>{debt.institution}</div>
          <div style={styles.title}>{debt.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ ...styles.value, color: '#c0392b' }}>{fmt(debt.balance)}</div>
          <div style={styles.subtle}>APR {pct(debt.apr)}</div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: '#566573' }}>
        <div>Estimated minimum: {fmt(estimateMinPayment(debt))}</div>
        {debt.dueDate && <div>Due date: {debt.dueDate}</div>}
        {util != null && <div>Utilization: {pct(util)}</div>}
      </div>
    </div>
  );
}

export default function DebtsDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [manualDebts, setManualDebts] = useState([]);
  const [plaidLiabilities, setPlaidLiabilities] = useState({ credit: [], student: [], mortgage: [] });
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [extraStudentPayment, setExtraStudentPayment] = useState(250);
  const [extraCardPayment, setExtraCardPayment] = useState(150);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [strategyData, setStrategyData] = useState(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [selectedCardAccount, setSelectedCardAccount] = useState('');
  const [manualExtraDebtPaymentAmount, setManualExtraDebtPaymentAmount] = useState(
    () => localStorage.getItem('extraDebtPaymentAmountOverride') || ''
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const now = new Date();
      const [manualRes, liabilitiesRes, debtAccountsRes, monthlyRes] = await Promise.all([
        axios.get('/api/goals/manual-debts/').catch(() => ({ data: [] })),
        axios.get('/api/plaid/liabilities').catch(() => ({ data: { credit: [], student: [], mortgage: [] } })),
        axios.get('/api/plaid/debt-accounts').catch(() => ({ data: [] })),
        axios.get(`/api/analytics/monthly-summary?year=${now.getFullYear()}&month=${now.getMonth() + 1}`).catch(() => ({ data: { income: 0 } })),
      ]);

      const liabilities = liabilitiesRes.data || { credit: [], student: [], mortgage: [] };
      const fallbackDebtAccounts = Array.isArray(debtAccountsRes.data) ? debtAccountsRes.data : [];

      const fallbackCredit = [];
      const fallbackStudent = [];
      for (const row of fallbackDebtAccounts) {
        const normalized = normalizePlaidDebtAccountFallback(row);
        if (!normalized) continue;
        const type = String(row.type || '').toLowerCase();
        const subtype = String(row.subtype || '').toLowerCase();
        if (type === 'credit' || subtype.includes('credit')) {
          fallbackCredit.push(normalized);
        } else if (type === 'loan' && subtype.includes('student')) {
          fallbackStudent.push(normalized);
        }
      }

      const creditSeen = new Set((liabilities.credit || []).map(c => String(c.account_id || c.name || '')));
      const mergedCredit = [
        ...(liabilities.credit || []),
        ...fallbackCredit.filter(c => !creditSeen.has(String(c.account_id || c.name || ''))),
      ];

      const studentSeen = new Set((liabilities.student || []).map(s => String(s.account_id || s.name || '')));
      const mergedStudent = [
        ...(liabilities.student || []),
        ...fallbackStudent.filter(s => !studentSeen.has(String(s.account_id || s.name || ''))),
      ];

      setManualDebts(Array.isArray(manualRes.data) ? manualRes.data : []);
      setPlaidLiabilities({
        ...liabilities,
        credit: mergedCredit,
        student: mergedStudent,
      });
      setMonthlyIncome(Number(monthlyRes.data?.income || 0));
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load debt data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allDebts = useMemo(() => {
    const manual = manualDebts.map(normalizeManualDebt);
    const plaidStudent = (plaidLiabilities.student || []).map(normalizePlaidStudentDebt);
    const plaidCredit = (plaidLiabilities.credit || []).map(normalizePlaidCreditDebt);
    return [...manual, ...plaidStudent, ...plaidCredit];
  }, [manualDebts, plaidLiabilities]);

  const fetchStrategy = useCallback(async (debtsForStrategy) => {
    setStrategyLoading(true);
    try {
      const payload = {
        debts: debtsForStrategy.map(d => ({
          name: d.name,
          debt_type: d.debtType,
          current_balance: d.balance,
          interest_rate: d.apr,
          minimum_payment: d.minPayment || null,
          institution_name: d.institution,
          source: d.source,
          next_payment_due_date: d.dueDate || null,
        })),
        extra_payment_budget: 0,
        lookback_days: 120,
        fixed_credit_card_name: 'AAdvantage',
        fixed_credit_card_autopay: 250,
        fixed_credit_card_extra: 750,
        student_strategy: 'avalanche',
        ignore_estimated_student_minimums: true,
        graduation_date: '2026-07-27',
        grace_period_months: 6,
        student_extra_override: manualExtraDebtPaymentAmount === '' ? null : Number(manualExtraDebtPaymentAmount || 0),
      };
      const res = await axios.post('/api/goals/debt-strategy', payload);
      setStrategyData(res.data);
    } catch {
      setStrategyData(null);
    } finally {
      setStrategyLoading(false);
    }
  }, [manualExtraDebtPaymentAmount]);

  useEffect(() => {
    if (!allDebts.length) {
      setStrategyData(null);
      return;
    }
    fetchStrategy(allDebts);
  }, [allDebts, fetchStrategy]);

  useEffect(() => {
    if (manualExtraDebtPaymentAmount === '') {
      localStorage.removeItem('extraDebtPaymentAmountOverride');
      return;
    }
    localStorage.setItem('extraDebtPaymentAmountOverride', String(manualExtraDebtPaymentAmount));
  }, [manualExtraDebtPaymentAmount]);

  const studentDebts = useMemo(
    () => allDebts.filter(d => d.debtType === 'student_loan'),
    [allDebts]
  );

  const creditDebts = useMemo(
    () => allDebts.filter(d => d.debtType === 'credit_card'),
    [allDebts]
  );

  const customPerAccount = useMemo(
    () => (strategyData?.custom_plan?.per_account_timelines || []),
    [strategyData]
  );

  const studentAccountTrajectories = useMemo(
    () => customPerAccount.filter(p => p.debt_type === 'student_loan'),
    [customPerAccount]
  );

  const cardAccountTrajectories = useMemo(
    () => customPerAccount.filter(p => p.debt_type === 'credit_card'),
    [customPerAccount]
  );

  useEffect(() => {
    if (!cardAccountTrajectories.length) {
      setSelectedCardAccount('');
      return;
    }
    if (!cardAccountTrajectories.some(a => a.name === selectedCardAccount)) {
      setSelectedCardAccount(cardAccountTrajectories[0].name);
    }
  }, [cardAccountTrajectories, selectedCardAccount]);

  const totals = useMemo(() => {
    const totalDebt = allDebts.reduce((s, d) => s + d.balance, 0);
    const studentTotal = studentDebts.reduce((s, d) => s + d.balance, 0);
    const creditTotal = creditDebts.reduce((s, d) => s + d.balance, 0);
    const minimums = allDebts.reduce((s, d) => s + estimateMinPayment(d), 0);
    const weightedApr = totalDebt > 0
      ? allDebts.reduce((s, d) => s + d.balance * d.apr, 0) / totalDebt
      : 0;
    const dti = monthlyIncome > 0 ? (minimums / monthlyIncome) * 100 : 0;
    return {
      totalDebt,
      studentTotal,
      creditTotal,
      minimums,
      weightedApr,
      dti,
    };
  }, [allDebts, studentDebts, creditDebts, monthlyIncome]);

  const studentTimeline = useMemo(
    () => buildPayoffTimeline(studentDebts, Number(extraStudentPayment || 0)),
    [studentDebts, extraStudentPayment]
  );

  const cardTimeline = useMemo(
    () => buildPayoffTimeline(creditDebts, Number(extraCardPayment || 0)),
    [creditDebts, extraCardPayment]
  );

  const debtMixData = {
    labels: ['Student Loans', 'Credit Cards', 'Other Debt'],
    datasets: [{
      data: [
        totals.studentTotal,
        totals.creditTotal,
        Math.max(totals.totalDebt - totals.studentTotal - totals.creditTotal, 0),
      ],
      backgroundColor: ['#2e86de', '#c0392b', '#7f8c8d'],
      borderWidth: 1,
    }],
  };

  const topDebts = [...allDebts]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 8);
  const topDebtsChart = {
    labels: topDebts.map(d => d.name.slice(0, 28)),
    datasets: [{
      label: 'Balance Owed',
      data: topDebts.map(d => d.balance),
      backgroundColor: topDebts.map(d => (d.debtType === 'credit_card' ? '#e74c3c' : '#3498db')),
    }],
  };

  const studentPayoffChart = {
    labels: studentTimeline.map(p => `M${p.month}`),
    datasets: [{
      label: 'Student Loan Balance',
      data: studentTimeline.map(p => p.balance),
      borderColor: '#2e86de',
      backgroundColor: 'rgba(46,134,222,0.12)',
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      borderWidth: 2,
    }],
  };

  const cardPayoffChart = {
    labels: cardTimeline.map(p => `M${p.month}`),
    datasets: [{
      label: 'Credit Card Balance',
      data: cardTimeline.map(p => p.balance),
      borderColor: '#c0392b',
      backgroundColor: 'rgba(192,57,43,0.12)',
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      borderWidth: 2,
    }],
  };

  const studentMonths = studentTimeline.length ? studentTimeline[studentTimeline.length - 1].month : 0;
  const cardMonths = cardTimeline.length ? cardTimeline[cardTimeline.length - 1].month : 0;

  const strategyMonthsChart = useMemo(() => {
    const rows = strategyData?.strategies || [];
    return {
      labels: rows.map(r => r.strategy.toUpperCase()),
      datasets: [{
        label: 'Months To Debt-Free',
        data: rows.map(r => r.months_to_debt_free),
        backgroundColor: ['#1f618d', '#117864', '#9a7d0a'],
      }],
    };
  }, [strategyData]);

  const strategyInterestChart = useMemo(() => {
    const rows = strategyData?.strategies || [];
    return {
      labels: rows.map(r => r.strategy.toUpperCase()),
      datasets: [{
        label: 'Estimated Interest Paid',
        data: rows.map(r => r.total_interest_paid),
        backgroundColor: ['#5dade2', '#58d68d', '#f8c471'],
      }],
    };
  }, [strategyData]);

  const customPlan = strategyData?.custom_plan || null;
  const baselineSnowball = useMemo(
    () => (strategyData?.strategies || []).find(s => s.strategy === 'snowball') || null,
    [strategyData]
  );
  const baselineAvalanche = useMemo(
    () => (strategyData?.strategies || []).find(s => s.strategy === 'avalanche') || null,
    [strategyData]
  );
  const nearTermPayoffs = useMemo(
    () => (customPlan?.student_payoff_order || []).filter(p => Number(p.month || 0) <= 12),
    [customPlan]
  );

  const selectedCardTrajectory = useMemo(
    () => cardAccountTrajectories.find(a => a.name === selectedCardAccount) || null,
    [cardAccountTrajectories, selectedCardAccount]
  );

  const studentMultiTrajectoryChart = useMemo(() => {
    const colors = ['#1f618d', '#2874a6', '#2e86c1', '#3498db', '#5dade2', '#7fb3d5', '#2471a3', '#85c1e9', '#21618c', '#5499c7', '#a9cce3', '#154360'];
    const longest = studentAccountTrajectories.reduce((m, a) => Math.max(m, (a.timeline || []).length), 0);
    const labels = Array.from({ length: longest }, (_, i) => `M${i}`);
    return {
      labels,
      datasets: studentAccountTrajectories.map((acct, idx) => ({
        label: acct.name,
        data: (acct.timeline || []).map(p => p.balance),
        borderColor: colors[idx % colors.length],
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.18,
        pointRadius: 0,
        borderWidth: 2,
      })),
    };
  }, [studentAccountTrajectories]);

  const selectedCardTrajectoryChart = useMemo(() => {
    const t = selectedCardTrajectory?.timeline || [];
    return {
      labels: t.map(p => `M${p.month}`),
      datasets: [{
        label: selectedCardTrajectory?.name || 'Credit Card',
        data: t.map(p => p.balance),
        borderColor: '#b03a2e',
        backgroundColor: 'rgba(176, 58, 46, 0.14)',
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2,
      }],
    };
  }, [selectedCardTrajectory]);

  if (loading) {
    return <div style={{ padding: 24 }}>Loading debt dashboard...</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Debt Command Center</h1>
          <p style={{ marginTop: 8, color: '#7f8c8d' }}>
            See debt health, payoff scenarios, and at-a-glance risk indicators.
          </p>
        </div>
        <button onClick={loadData} style={styles.refreshBtn}>Refresh Data</button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tabRow}>
        {TAB_DEFS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ ...styles.tabBtn, ...(activeTab === tab.id ? styles.tabBtnActive : {}) }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div style={styles.grid4}>
            <Metric title='Total Debt' value={fmt(totals.totalDebt)} color='#c0392b' />
            <Metric title='Student Loans' value={fmt(totals.studentTotal)} color='#2980b9' />
            <Metric title='Credit Cards' value={fmt(totals.creditTotal)} color='#922b21' />
            <Metric title='Debt-to-Income (Est.)' value={pct(totals.dti)} color={totals.dti >= 43 ? '#c0392b' : totals.dti >= 30 ? '#d68910' : '#1e8449'} />
          </div>

          {!!customPlan && (
            <div style={styles.grid4}>
              <Metric title='Plan Debt-Free' value={`M${customPlan.months_to_debt_free || 0}`} color='#1f618d' />
              <Metric title='Projected Debt-Free Date' value={payoffDateFromNow(customPlan.months_to_debt_free)} color='#117864' />
              <Metric title='Extra Debt Payment Amount In Use' value={fmt(customPlan.student_extra_payment_used)} color='#1e8449' />
              <Metric title='Plan Interest (Total)' value={fmt(customPlan.total_interest_paid)} color='#a04000' />
            </div>
          )}

          <div style={styles.grid2}>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Debt Mix</h3>
              <div style={{ height: 300 }}>
                <Doughnut
                  data={debtMixData}
                  options={{
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } },
                  }}
                />
              </div>
            </div>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Largest Balances</h3>
              <div style={{ height: 300 }}>
                <Bar
                  data={topDebtsChart}
                  options={{
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ticks: { callback: v => '$' + Number(v).toLocaleString() } },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          <div style={styles.grid3}>
            <Metric title='Weighted Avg APR' value={pct(totals.weightedApr)} />
            <Metric title='Estimated Monthly Minimums' value={fmt(totals.minimums)} />
            <Metric title='Coverage Ratio (Income/Minimums)' value={totals.minimums > 0 ? `${(monthlyIncome / totals.minimums).toFixed(2)}x` : 'N/A'} />
          </div>
        </>
      )}

      {activeTab === 'student' && (
        <>
          <div style={styles.panel}>
            <div style={styles.rowBetween}>
              <h3 style={styles.panelTitle}>Student Loan Payoff What-If</h3>
              <label style={styles.inlineInput}>
                Extra monthly payment
                <input
                  type='number'
                  min='0'
                  step='25'
                  value={extraStudentPayment}
                  onChange={e => setExtraStudentPayment(Number(e.target.value || 0))}
                  style={styles.numberInput}
                />
              </label>
            </div>
            <div style={{ height: 320 }}>
              <Line
                data={studentPayoffChart}
                options={{
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } },
                  },
                }}
              />
            </div>
            <p style={styles.footnote}>
              Estimated payoff timeline: {studentMonths} months with {fmt(extraStudentPayment)} extra payment.
            </p>
          </div>

          <div style={styles.panel}>
            <div style={styles.rowBetween}>
              <h3 style={styles.panelTitle}>Student Loan Account Trajectories (Plan-Based)</h3>
            </div>
            {!!studentAccountTrajectories.length && (
              <>
                <div style={{ height: 320 }}>
                  <Line
                    data={studentMultiTrajectoryChart}
                    options={{
                      maintainAspectRatio: false,
                      plugins: { legend: { display: true, position: 'bottom' } },
                      scales: {
                        y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } },
                      },
                    }}
                  />
                </div>
                <p style={styles.footnote}>
                  Uses strategy assumptions: fixed AAdvantage payment ({fmt(strategyData?.custom_plan?.fixed_card_monthly_payment)}) and student {String(strategyData?.custom_plan?.student_strategy || 'avalanche')} with recommended extra debt payment amount of {fmt(strategyData?.custom_plan?.recommended_student_extra_payment)}.
                </p>
              </>
            )}
            {!studentAccountTrajectories.length && <div style={styles.empty}>No per-account student trajectory data yet.</div>}
          </div>

          <div style={styles.grid2}>
            {studentDebts.map(d => <DebtCard key={d.id} debt={d} />)}
            {!studentDebts.length && <div style={styles.empty}>No student loans found.</div>}
          </div>
        </>
      )}

      {activeTab === 'cards' && (
        <>
          <div style={styles.panel}>
            <div style={styles.rowBetween}>
              <h3 style={styles.panelTitle}>Credit Card Payoff What-If</h3>
              <label style={styles.inlineInput}>
                Extra monthly payment
                <input
                  type='number'
                  min='0'
                  step='25'
                  value={extraCardPayment}
                  onChange={e => setExtraCardPayment(Number(e.target.value || 0))}
                  style={styles.numberInput}
                />
              </label>
            </div>
            <div style={{ height: 320 }}>
              <Line
                data={cardPayoffChart}
                options={{
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } },
                  },
                }}
              />
            </div>
            <p style={styles.footnote}>
              Estimated payoff timeline: {cardMonths} months with {fmt(extraCardPayment)} extra payment.
            </p>
          </div>

          <div style={styles.panel}>
            <div style={styles.rowBetween}>
              <h3 style={styles.panelTitle}>Credit Card Account Trajectory (Plan-Based)</h3>
              <label style={styles.inlineInput}>
                Account
                <select
                  value={selectedCardAccount}
                  onChange={e => setSelectedCardAccount(e.target.value)}
                  style={styles.numberInput}
                >
                  {cardAccountTrajectories.map(a => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {!!selectedCardTrajectory && (
              <div style={{ height: 320 }}>
                <Line
                  data={selectedCardTrajectoryChart}
                  options={{
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } },
                    },
                  }}
                />
              </div>
            )}
            {!selectedCardTrajectory && <div style={styles.empty}>No per-account card trajectory data yet.</div>}
          </div>

          <div style={styles.grid2}>
            {creditDebts.map(d => <DebtCard key={d.id} debt={d} />)}
            {!creditDebts.length && <div style={styles.empty}>No credit card debts found.</div>}
          </div>
        </>
      )}

      {activeTab === 'strategy' && (
        <>
          {strategyLoading && <div style={styles.panel}>Building strategy scenarios...</div>}
          {!strategyLoading && !strategyData && (
            <div style={styles.empty}>Could not build strategy yet. Refresh data and try again.</div>
          )}
          {!strategyLoading && strategyData && (
            <>
              <div style={styles.grid4}>
                <Metric title='Recommended Strategy' value={(strategyData.recommended_strategy || 'n/a').toUpperCase()} color='#1f618d' />
                <Metric title='Monthly Income (Est.)' value={fmt(strategyData.context?.monthly_income_estimate)} />
                <Metric title='Debt-Service Ratio (Est.)' value={pct(strategyData.context?.debt_to_income_ratio_estimate)} color={Number(strategyData.context?.debt_to_income_ratio_estimate || 0) >= 43 ? '#c0392b' : '#1e8449'} />
                <Metric title='Available Extra (Est.)' value={fmt(strategyData.context?.available_extra_payment_estimate)} color='#117864' />
              </div>

              <div style={styles.grid3}>
                <Metric title='Fixed Card Target' value={strategyData.custom_plan?.fixed_card || 'N/A'} color='#922b21' />
                <Metric title='Fixed Card Monthly Pay' value={fmt(strategyData.custom_plan?.fixed_card_monthly_payment)} color='#922b21' />
                <Metric
                  title={strategyData.custom_plan?.student_extra_is_manual_override ? 'Extra Debt Payment Amount (Manual)' : 'Recommended Extra Debt Payment Amount'}
                  value={fmt(strategyData.custom_plan?.student_extra_payment_used)}
                  color='#1e8449'
                />
              </div>

              <div style={styles.grid4}>
                <Metric title='Plan Debt-Free' value={`M${customPlan?.months_to_debt_free || 0}`} color='#1f618d' />
                <Metric title='Projected Debt-Free Date' value={payoffDateFromNow(customPlan?.months_to_debt_free)} color='#117864' />
                <Metric title='Plan Total Paid' value={fmt(customPlan?.total_paid)} color='#566573' />
                <Metric title='Plan Total Interest' value={fmt(customPlan?.total_interest_paid)} color='#a04000' />
              </div>

              <div style={styles.panel}>
                <h3 style={styles.panelTitle}>Plan Assumptions</h3>
                <div style={styles.infoRow}><strong>Card Focus:</strong> {customPlan?.fixed_card || 'N/A'} at {fmt(customPlan?.fixed_card_monthly_payment)} / month</div>
                <div style={styles.infoRow}><strong>Student Strategy:</strong> {String(customPlan?.student_strategy || 'avalanche').toUpperCase()}</div>
                <div style={styles.infoRow}><strong>Extra Debt Payment Amount Source:</strong> {customPlan?.student_extra_is_manual_override ? 'Manual override' : 'Cashflow auto-calc'}</div>
                <div style={styles.infoRow}><strong>Extra Debt Payment Amount Used:</strong> {fmt(customPlan?.student_extra_payment_used)}</div>
                <div style={styles.infoRow}><strong>Extra Debt Payment Amount Recommended:</strong> {fmt(customPlan?.recommended_student_extra_payment)}</div>
                <div style={styles.infoRow}><strong>Grace End Assumption:</strong> {customPlan?.grace_period?.assumed_grace_end_date ? new Date(customPlan.grace_period.assumed_grace_end_date).toLocaleDateString() : 'Per account due date / unknown'}</div>
                <div style={styles.infoRow}><strong>Income - Non-Debt Expenses (Est.):</strong> {fmt((strategyData.context?.monthly_income_estimate || 0) - (strategyData.context?.monthly_non_debt_expenses_estimate || 0))}</div>
              </div>

              <div style={styles.panel}>
                <h3 style={styles.panelTitle}>Timeline Comparison</h3>
                <div style={styles.infoRow}><strong>Custom Plan:</strong> M{customPlan?.months_to_debt_free || 0} ({payoffDateFromNow(customPlan?.months_to_debt_free)})</div>
                <div style={styles.infoRow}><strong>Baseline Avalanche:</strong> {baselineAvalanche ? `M${baselineAvalanche.months_to_debt_free}` : 'N/A'}</div>
                <div style={styles.infoRow}><strong>Baseline Snowball:</strong> {baselineSnowball ? `M${baselineSnowball.months_to_debt_free}` : 'N/A'}</div>
                <div style={styles.infoRow}><strong>Interest vs Baseline Snowball:</strong> {baselineSnowball ? fmt((baselineSnowball.total_interest_paid || 0) - (customPlan?.total_interest_paid || 0)) : 'N/A'} lower</div>
              </div>

              <div style={styles.panel}>
                <div style={styles.rowBetween}>
                  <h3 style={styles.panelTitle}>Extra Debt Payment Amount Override</h3>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={styles.inlineInput}>
                    Manual monthly extra debt payment amount
                    <input
                      type='number'
                      min='0'
                      step='25'
                      value={manualExtraDebtPaymentAmount}
                      onChange={e => setManualExtraDebtPaymentAmount(e.target.value)}
                      placeholder='Auto-calc from cashflow'
                      style={styles.numberInput}
                    />
                  </label>
                  <button
                    onClick={() => setManualExtraDebtPaymentAmount('')}
                    style={styles.refreshBtn}
                    type='button'
                  >
                    Use Auto Amount
                  </button>
                </div>
                <p style={styles.footnote}>
                  Leave blank to auto-calculate from detected income and expenses. Set a value to simulate planned cash that is not yet visible due to pending paychecks.
                </p>
              </div>

              <div style={styles.panel}>
                <h3 style={styles.panelTitle}>Student Loan Attack Order</h3>
                <p style={styles.footnote}>
                  Ordered by the selected student strategy. Loans in grace get no required payment until grace ends, unless they are the active attack loan receiving minimum + extra debt payment amount.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>#</th>
                        <th style={styles.th}>Loan</th>
                        <th style={styles.th}>APR</th>
                        <th style={styles.th}>Balance</th>
                        <th style={styles.th}>In Grace Now</th>
                        <th style={styles.th}>Grace End</th>
                        <th style={styles.th}>Projected Payoff Month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(strategyData.custom_plan?.student_attack_order || []).map((s, idx) => {
                        const payoff = (strategyData.custom_plan?.student_payoff_order || []).find(p => p.name === s.name);
                        return (
                          <tr key={`${s.name}-${idx}`}>
                            <td style={styles.td}>{idx + 1}</td>
                            <td style={styles.td}>{s.name}</td>
                            <td style={styles.td}>{pct(s.apr)}</td>
                            <td style={styles.td}>{fmt(s.current_balance)}</td>
                            <td style={styles.td}>{s.in_grace_now ? 'Yes' : 'No'}</td>
                            <td style={styles.td}>{s.grace_end_date ? new Date(s.grace_end_date).toLocaleDateString() : '—'}</td>
                            <td style={styles.td}>{payoff ? `M${payoff.month}` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={styles.panel}>
                <h3 style={styles.panelTitle}>Next 12-Month Student Milestones</h3>
                {!nearTermPayoffs.length && (
                  <p style={styles.footnote}>No student loans are projected to fully close in the next 12 months under current settings.</p>
                )}
                {!!nearTermPayoffs.length && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Loan</th>
                          <th style={styles.th}>Projected Payoff Month</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nearTermPayoffs.map((row) => (
                          <tr key={row.name}>
                            <td style={styles.td}>{row.name}</td>
                            <td style={styles.td}>{`M${row.month}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={styles.panel}>
                <h3 style={styles.panelTitle}>Recommendation Rationale</h3>
                <p style={{ margin: 0, color: '#566573' }}>{strategyData.rationale}</p>
              </div>

              <div style={styles.grid2}>
                <div style={styles.panel}>
                  <h3 style={styles.panelTitle}>Payoff Speed Comparison</h3>
                  <div style={{ height: 280 }}>
                    <Bar
                      data={strategyMonthsChart}
                      options={{
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                      }}
                    />
                  </div>
                </div>
                <div style={styles.panel}>
                  <h3 style={styles.panelTitle}>Interest Cost Comparison</h3>
                  <div style={{ height: 280 }}>
                    <Bar
                      data={strategyInterestChart}
                      options={{
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                          y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } },
                        },
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={styles.panel}>
                <h3 style={styles.panelTitle}>Manual Debt Payment Detection (from transactions)</h3>
                <p style={styles.footnote}>
                  These signals are inferred from transaction descriptions and amounts for debts not linked through Plaid.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Debt</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Last Payment</th>
                        <th style={styles.th}>Avg Monthly (Detected)</th>
                        <th style={styles.th}>Estimated Minimum</th>
                        <th style={styles.th}>Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(strategyData.manual_payment_signals || []).map((s) => (
                        <tr key={s.manual_debt_id}>
                          <td style={styles.td}>{s.name}</td>
                          <td style={styles.td}>{s.status}</td>
                          <td style={styles.td}>{s.last_detected_payment_date ? new Date(s.last_detected_payment_date).toLocaleDateString() : '—'}</td>
                          <td style={styles.td}>{fmt(s.avg_detected_monthly_payment)}</td>
                          <td style={styles.td}>{fmt(s.estimated_minimum)}</td>
                          <td style={styles.td}>{s.detected_payments_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ title, value, color }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={{ ...styles.metricValue, color: color || '#2c3e50' }}>{value}</div>
    </div>
  );
}

const styles = {
  tabRow: {
    display: 'flex',
    gap: 8,
    margin: '18px 0 20px',
    flexWrap: 'wrap',
  },
  tabBtn: {
    border: '1px solid #d6dbdf',
    background: '#f8f9fa',
    color: '#2c3e50',
    borderRadius: 999,
    padding: '8px 14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabBtnActive: {
    background: '#1f618d',
    color: '#fff',
    borderColor: '#1f618d',
  },
  refreshBtn: {
    border: 'none',
    background: '#117a65',
    color: '#fff',
    borderRadius: 8,
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7e9',
    borderRadius: 12,
    padding: 16,
  },
  panelTitle: {
    margin: '0 0 10px',
    color: '#2c3e50',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 16,
    marginTop: 16,
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
    gap: 12,
    marginTop: 16,
  },
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  metricCard: {
    background: '#fff',
    border: '1px solid #e5e7e9',
    borderRadius: 12,
    padding: 14,
  },
  metricTitle: {
    fontSize: 12,
    color: '#7f8c8d',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 25,
    fontWeight: 700,
  },
  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  inlineInput: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#566573',
    fontWeight: 600,
  },
  numberInput: {
    width: 120,
    border: '1px solid #ccd1d1',
    borderRadius: 8,
    padding: '6px 8px',
  },
  footnote: {
    marginTop: 10,
    marginBottom: 0,
    color: '#7f8c8d',
    fontSize: 12,
  },
  infoRow: {
    color: '#2c3e50',
    fontSize: 14,
    lineHeight: 1.6,
  },
  card: {
    background: '#fff',
    border: '1px solid #e5e7e9',
    borderRadius: 12,
    padding: 14,
  },
  subtle: {
    color: '#7f8c8d',
    fontSize: 12,
  },
  title: {
    color: '#2c3e50',
    fontSize: 16,
    fontWeight: 700,
  },
  value: {
    fontSize: 20,
    fontWeight: 700,
  },
  error: {
    background: '#fdecea',
    border: '1px solid #f5c6cb',
    color: '#9f3a38',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 12,
  },
  empty: {
    background: '#f8f9fa',
    border: '1px dashed #d5d8dc',
    color: '#7f8c8d',
    borderRadius: 12,
    padding: 20,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid #e5e7e9',
    color: '#566573',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #f2f3f4',
    color: '#2c3e50',
    whiteSpace: 'nowrap',
  },
};
