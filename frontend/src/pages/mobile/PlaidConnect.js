import React, { useState, useEffect, useCallback } from 'react';
import axios from '../../api';

/**
 * PlaidConnect
 *
 * Renders a "Connect Bank" card.
 * Uses Plaid Link via the official `react-plaid-link` library.
 *
 * SETUP:
 *   cd frontend && npm install react-plaid-link
 *
 * Then set PLAID_CLIENT_ID and PLAID_SECRET in backend/.env (sandbox creds).
 * Get free sandbox keys: https://dashboard.plaid.com/signup
 */
let usePlaidLink;
try {
  // Dynamic import keeps the bundle buildable even when the package isn't installed yet
  usePlaidLink = require('react-plaid-link').usePlaidLink;
} catch {
  usePlaidLink = null;
}

// ── Inner component (rendered once we have a link_token) ──────────────────

function PlaidLinkButton({ linkToken, accountId, onSuccess }) {
  const [loadError] = useState(!usePlaidLink);

  const onPlaidSuccess = useCallback(
    async (publicToken, metadata) => {
      try {
        const res = await axios.post('/api/plaid/exchange', {
          public_token: publicToken,
          institution_name: metadata?.institution?.name ?? null,
          account_id: accountId ?? null,
        });
        const { added, categorized } = res.data;
        onSuccess({ added, categorized, institution: metadata?.institution?.name });
      } catch (e) {
        console.error('Plaid exchange failed', e);
        onSuccess(null, e.message ?? 'Exchange failed');
      }
    },
    [accountId, onSuccess]
  );

  if (loadError) {
    return (
      <div className="m-error" style={{ padding: '12px 0', fontSize: 13 }}>
        Install <code>react-plaid-link</code> to enable bank linking:
        <br />
        <code>cd frontend &amp;&amp; npm install react-plaid-link</code>
      </div>
    );
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess: onPlaidSuccess });

  return (
    <button
      className="m-btn-save"
      style={{ width: '100%', padding: '14px', borderRadius: 12, fontSize: 16 }}
      onClick={() => open()}
      disabled={!ready}
    >
      Connect Bank Account
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function PlaidConnect({ onLinked }) {
  const [linkToken, setLinkToken] = useState(null);
  const [linkedItems, setLinkedItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [status, setStatus] = useState(null);   // { type: 'success'|'error', message }
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(null); // item_id being synced

  const waitForSyncResult = async (jobId) => {
    const maxAttempts = 90; // ~3 minutes at 2s intervals
    for (let i = 0; i < maxAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // eslint-disable-next-line no-await-in-loop
      const statusRes = await axios.get(`/api/plaid/sync/status/${jobId}`);
      const job = statusRes.data;
      if (job.status === 'done') return job.result;
      if (job.status === 'error') {
        throw new Error(job.error || 'Sync failed');
      }
    }
    throw new Error('Sync timed out. Please try again.');
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenRes, itemsRes, accsRes] = await Promise.all([
        axios.post('/api/plaid/link-token').catch(() => null),
        axios.get('/api/plaid/items').catch(() => ({ data: [] })),
        axios.get('/api/accounts/').catch(() => ({ data: [] })),
      ]);
      if (tokenRes) setLinkToken(tokenRes.data.link_token);
      setLinkedItems(itemsRes.data);
      setAccounts(accsRes.data);
      if (accsRes.data.length && !selectedAccountId) {
        setSelectedAccountId(String(accsRes.data[0].id));
      }
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => { fetchData(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSuccess = ({ added, categorized, institution }) => {
    setStatus({
      type: 'success',
      message: `✅ ${institution ?? 'Bank'} connected! Imported ${added} transactions, auto-categorised ${categorized}.`,
    });
    fetchData();
    if (onLinked) onLinked();
  };

  const handleSync = async (itemId) => {
    setSyncing(itemId);
    try {
      const startRes = await axios.post(`/api/plaid/sync/${itemId}`);
      const result = await waitForSyncResult(startRes.data.job_id);
      setStatus({
        type: 'success',
        message: `Synced! ${result.added} new, ${result.modified} updated, ${result.removed} removed.`,
      });
      await fetchData();
      if (onLinked) onLinked();
    } catch (e) {
      setStatus({
        type: 'error',
        message: e.response?.data?.detail ?? e.message ?? 'Sync failed',
      });
    } finally {
      setSyncing(null);
    }
  };

  const handleRemove = async (itemId) => {
    if (!window.confirm('Disconnect this bank account?')) return;
    try {
      await axios.delete(`/api/plaid/items/${itemId}`);
      fetchData();
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    }
  };

  if (loading) return <div className="m-loading">Loading…</div>;

  return (
    <>
      {/* Status message */}
      {status && (
        <div
          className="m-card"
          style={{
            background: status.type === 'success' ? '#f0fff4' : '#fff2f2',
            borderLeft: `3px solid ${status.type === 'success' ? '#34c759' : '#ff3b30'}`,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: status.type === 'success' ? '#1a7a3a' : '#c0392b' }}>
            {status.message}
          </p>
        </div>
      )}

      {/* Connect new bank */}
      <div className="m-card">
        <div className="m-card-title">Link a Bank</div>

        {accounts.length > 0 && (
          <div className="m-form-section" style={{ marginBottom: 14 }}>
            <label className="m-form-label">Attach to account</label>
            <select
              className="m-form-input"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {linkToken ? (
          <PlaidLinkButton
            linkToken={linkToken}
            accountId={selectedAccountId ? Number(selectedAccountId) : null}
            onSuccess={handleSuccess}
          />
        ) : (
          <div className="m-error" style={{ padding: '8px 0', fontSize: 13 }}>
            Could not load Plaid. Check that PLAID_CLIENT_ID and PLAID_SECRET are set in backend/.env
          </div>
        )}
      </div>

      {/* Existing connections */}
      {linkedItems.length > 0 && (
        <div className="m-card">
          <div className="m-card-title">Connected Banks</div>
          {linkedItems.map((item) => (
            <div
              key={item.item_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 0',
                borderBottom: '1px solid #f2f2f7',
              }}
            >
              <span style={{ fontSize: 22 }}>🏦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  {item.institution_name ?? 'Bank'}
                </div>
                {item.last_synced_at && (
                  <div style={{ fontSize: 12, color: '#8e8e93' }}>
                    Last synced: {new Date(item.last_synced_at).toLocaleString()}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleSync(item.item_id)}
                disabled={syncing === item.item_id}
                style={{
                  border: '1px solid #007aff',
                  color: '#007aff',
                  background: 'none',
                  borderRadius: 20,
                  padding: '4px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  marginRight: 6,
                }}
              >
                {syncing === item.item_id ? '…' : 'Sync'}
              </button>
              <button
                onClick={() => handleRemove(item.item_id)}
                style={{
                  border: '1px solid #ff3b30',
                  color: '#ff3b30',
                  background: 'none',
                  borderRadius: 20,
                  padding: '4px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
