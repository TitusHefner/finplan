import React, { useState, useCallback, useEffect } from 'react';
import axios from '../../api';
import { fmt } from './MobileDashboard';

const ACCOUNT_ICONS = {
  checking:    '🏦',
  savings:     '💰',
  credit_card: '💳',
  investment:  '📈',
  loan:        '🔁',
  cash:        '👛',
};

export default function MobileAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/mobile/accounts');
      setAccounts(res.data);
    } catch (e) {
      setError(e.message ?? 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="m-loading">Loading accounts…</div>;
  if (error) return (
    <div className="m-error">
      {error}
      <button className="m-retry-btn" onClick={load}>Retry</button>
    </div>
  );
  if (!accounts.length) return (
    <div className="m-empty">No accounts yet.<br />Add accounts using the web app.</div>
  );

  const total = accounts.reduce((s, a) => s + a.balance, 0);


  return (
    <div className="m-card">
      <div className="m-accounts-total">
        <span>Total balance</span>
        <span className="m-accounts-total-value">{fmt(total)}</span>
      </div>
      {accounts.map((a) => (
        <div className="m-account-row" key={a.id}>
          <div className="m-account-icon">
            {ACCOUNT_ICONS[a.type] ?? '🏛️'}
          </div>
          <div className="m-account-info">
            <div className="m-account-name">{a.name}</div>
            <div className="m-account-sub">
              {a.institution
                ? a.institution
                : a.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </div>
          </div>
          <div className={`m-account-balance ${a.balance < 0 ? 'negative' : ''}`}>
            {fmt(a.balance)}
          </div>
        </div>
      ))}
    </div>
  );
}
