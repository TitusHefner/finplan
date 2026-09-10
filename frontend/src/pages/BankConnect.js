import React, { useState, useEffect, useCallback } from 'react';
import axios from '../api';

let usePlaidLink;
try {
  usePlaidLink = require('react-plaid-link').usePlaidLink;
} catch {
  usePlaidLink = null;
}

// ── Plaid Link button (inner component, needs linkToken) ──────────────────

function PlaidLinkButton({ linkToken, accountId, onSuccess, onExit, isOAuthReturn }) {
  const onPlaidSuccess = useCallback(
    async (publicToken, metadata) => {
      try {
        const res = await axios.post('/api/plaid/exchange', {
          public_token: publicToken,
          institution_name: metadata?.institution?.name ?? null,
          account_id: accountId ?? null,
        });
        onSuccess({ added: res.data.added, categorized: res.data.categorized, institution: metadata?.institution?.name });
      } catch (e) {
        onSuccess(null, e.response?.data?.detail ?? e.message ?? 'Exchange failed');
      }
    },
    [accountId, onSuccess]
  );

  const config = {
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: (err, metadata) => {
      if (err) {
        onExit?.(`Plaid error: ${err.display_message || err.error_message || err.error_code || 'Unknown error'}`);
      } else {
        // User closed the modal without completing — no error, just inform parent
        onExit?.(null);
      }
    },
  };
  // For OAuth redirect flows, receivedRedirectUri must be set on return
  if (isOAuthReturn) {
    config.receivedRedirectUri = window.location.href;
  }

  const { open, ready } = usePlaidLink(config);

  // Auto-open on OAuth return
  useEffect(() => {
    if (isOAuthReturn && ready) open();
  }, [isOAuthReturn, ready, open]);

  return (
    <button className="btn btn-primary" onClick={open} disabled={!ready}>
      🏦 Open Plaid Link
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function BankConnect() {
  const [accounts, setAccounts] = useState([]);
  const [linkedItems, setLinkedItems] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [linkToken, setLinkToken] = useState(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [statusType, setStatusType] = useState('info');
  const [recategorizing, setRecategorizing] = useState(false);
  const [reAuthItemId, setReAuthItemId] = useState(null);  // item_id that needs re-auth
  const [reAuthToken, setReAuthToken] = useState(null);    // update-mode link token

  // Detect OAuth redirect return (Plaid appends ?oauth_state_id=... to the URI)
  const isOAuthReturn = window.location.search.includes('oauth_state_id');

  const notify = (msg, type = 'info') => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const loadData = useCallback(async () => {
    try {
      const [accRes, itemsRes] = await Promise.all([
        axios.get('/api/accounts/'),
        axios.get('/api/plaid/items'),
      ]);
      setAccounts(accRes.data);
      setLinkedItems(itemsRes.data);
    } catch (e) {
      notify('Failed to load data: ' + (e.response?.data?.detail ?? e.message), 'error');
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // On OAuth return, automatically re-fetch a link token to complete the flow
  useEffect(() => {
    if (isOAuthReturn && !linkToken) fetchLinkToken();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOAuthReturn]);

  const fetchLinkToken = async () => {
    if (!usePlaidLink) {
      notify('react-plaid-link is not installed. Run: cd frontend && npm install react-plaid-link', 'error');
      return;
    }
    setLoadingToken(true);
    try {
      const res = await axios.post('/api/plaid/link-token');
      setLinkToken(res.data.link_token);
    } catch (e) {
      notify('Could not create link token: ' + (e.response?.data?.detail ?? e.message), 'error');
    } finally {
      setLoadingToken(false);
    }
  };

  const onPlaidSuccess = async (result, error) => {
    setLinkToken(null);
    if (error) {
      notify(error, 'error');
      return;
    }
    const { added, categorized, institution } = result;
    if (added === 0) {
      notify(
        `✅ ${institution ?? 'Bank'} connected! Your bank is still loading transaction history — click Sync in a moment to import.`,
        'info'
      );
    } else {
      notify(
        `✅ ${institution ?? 'Bank'} connected! ${added} transaction${added !== 1 ? 's' : ''} imported, ${categorized} auto-categorized.`,
        'success'
      );
    }
    loadData();
  };

  const syncItem = async (itemId) => {
    setSyncingId(itemId);
    try {
      // Kick off background sync — returns immediately with a job_id
      const startRes = await axios.post(`/api/plaid/sync/${itemId}`);
      const jobId = startRes.data.job_id;

      // Poll every 2 seconds until done or error
      const poll = () => new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const statusRes = await axios.get(`/api/plaid/sync/status/${jobId}`);
            const job = statusRes.data;
            if (job.status === 'done') {
              clearInterval(iv);
              resolve(job.result);
            } else if (job.status === 'error') {
              clearInterval(iv);
              reject(new Error(job.error));
            }
            // still 'running' — keep polling
          } catch (e) {
            clearInterval(iv);
            reject(e);
          }
        }, 2000);
      });

      const result = await poll();
      const base = `Synced: ${result.added} new, ${result.modified} updated, ${result.removed} removed.`;
      const msg = result.note ? `${base} ⚠️ ${result.note}` : base;
      notify(msg, result.note ? 'warning' : 'success');
      loadData();
    } catch (e) {
      const msg = e.response?.data?.detail ?? e.message ?? '';
      if (typeof msg === 'string' && msg.includes('ITEM_LOGIN_REQUIRED')) {
        notify('Bank login expired — click Re-authenticate to reconnect.', 'warning');
        setReAuthItemId(itemId);
      } else {
        notify('Sync failed: ' + msg, 'error');
      }
    } finally {
      setSyncingId(null);
    }
  };

  const startReAuth = async (itemId) => {
    if (!usePlaidLink) {
      notify('react-plaid-link is not installed.', 'error');
      return;
    }
    try {
      const res = await axios.post(`/api/plaid/link-token/update/${itemId}`);
      setReAuthItemId(itemId);
      setReAuthToken(res.data.link_token);
    } catch (e) {
      notify('Could not start re-auth: ' + (e.response?.data?.detail ?? e.message), 'error');
    }
  };

  const onReAuthSuccess = async (publicToken, metadata) => {
    // Capture itemId before clearing state
    const itemId = reAuthItemId ?? metadata?.item?.item_id;
    setReAuthToken(null);
    setReAuthItemId(null);
    try {
      // Reset the stored cursor so the next sync re-fetches everything since
      // the last successful page — Plaid often invalidates cursors after ITEM_LOGIN_REQUIRED
      await axios.post(`/api/plaid/items/${itemId}/reset-cursor`);
      const startRes = await axios.post(`/api/plaid/sync/${itemId}`);
      const jobId = startRes.data.job_id;

      const poll = () => new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const statusRes = await axios.get(`/api/plaid/sync/status/${jobId}`);
            const job = statusRes.data;
            if (job.status === 'done') {
              clearInterval(iv);
              resolve(job.result);
            } else if (job.status === 'error') {
              clearInterval(iv);
              reject(new Error(job.error));
            }
          } catch (e) {
            clearInterval(iv);
            reject(e);
          }
        }, 2000);
      });

      const result = await poll();
      const base = `Re-authenticated and synced: ${result.added} new, ${result.modified} updated, ${result.removed} removed.`;
      notify(result.note ? `${base} ⚠️ ${result.note}` : base, result.note ? 'warning' : 'success');
      loadData();
    } catch (e) {
      notify('Re-auth succeeded but sync failed: ' + (e.response?.data?.detail ?? e.message), 'warning');
    }
  };

  const recategorizeAll = async () => {
    setRecategorizing(true);
    try {
      const res = await axios.post('/api/plaid/recategorize');
      notify(`Re-categorized ${res.data.categorized} of ${res.data.processed} transactions.`, 'success');
    } catch (e) {
      notify('Recategorize failed: ' + (e.response?.data?.detail ?? e.message), 'error');
    } finally {
      setRecategorizing(false);
    }
  };

  const removeItem = async (itemId, name) => {
    const deleteTx = window.confirm(
      `Unlink ${name ?? 'this bank'}?\n\nClick OK to also DELETE all imported transactions.\nClick Cancel to keep the transactions but still unlink the bank.`
    );
    // If user pressed the browser-level cancel on the whole dialog, bail out
    // (we can't distinguish 'Cancel' from 'X' in a confirm, so we treat Cancel as "keep txns")
    // Use a second confirm to allow truly cancelling the unlink altogether:
    const proceed = deleteTx || window.confirm(`Unlink ${name ?? 'this bank'} but keep transactions?`);
    if (!proceed) return;
    try {
      const res = await axios.delete(`/api/plaid/items/${itemId}?delete_transactions=${deleteTx}`);
      const txMsg = deleteTx ? ` ${res.data.transactions_deleted} transactions deleted.` : ' Transactions kept.';
      notify(`Bank unlinked.${txMsg}`, 'success');
      loadData();
    } catch (e) {
      notify('Remove failed: ' + (e.response?.data?.detail ?? e.message), 'error');
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <h1>🏦 Bank Connections</h1>
        <p className="page-subtitle">Link your bank accounts to automatically import and categorize transactions via Plaid.</p>
      </div>

      {/* Status banner */}
      {statusMsg && (
        <div className={`alert alert-${statusType}`} style={{ marginBottom: '1.5rem' }}>
          {statusMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'start' }}>

        {/* ── Connect new bank ── */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Connect a Bank</h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Select an internal account to attach imported transactions to, then open Plaid Link to authenticate with your bank.
            </p>

            <div className="form-group">
              <label className="form-label">Attach to Account <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span></label>
              <select
                className="form-control"
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
              >
                <option value="">— none —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {!linkToken ? (
              <button className="btn btn-primary" onClick={fetchLinkToken} disabled={loadingToken}>
                {loadingToken ? 'Getting link…' : '🔗 Connect Bank via Plaid'}
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <PlaidLinkButton
                  linkToken={linkToken}
                  accountId={selectedAccountId || null}
                  onSuccess={onPlaidSuccess}
                  onExit={(errMsg) => {
                    setLinkToken(null);
                    if (errMsg) notify(errMsg, 'error');
                    else notify('Bank connection cancelled.', 'info');
                  }}
                  isOAuthReturn={isOAuthReturn}
                />
                <button className="btn btn-secondary" onClick={() => setLinkToken(null)}>Cancel</button>
              </div>
            )}

            {!usePlaidLink && (
              <div className="alert alert-error">
                <strong>Package missing.</strong> Run <code>npm install react-plaid-link</code> inside the <code>frontend/</code> folder then restart the dev server.
              </div>
            )}
          </div>
        </div>

        {/* ── Linked banks ── */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Linked Banks</h2>
          </div>
          <div className="card-body">
            {linkedItems.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem 0' }}>
                No banks linked yet.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Last Synced</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedItems.map(item => (
                    <tr key={item.id}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{item.institution_name ?? 'Unknown Bank'}</span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        {item.last_synced_at
                          ? new Date(item.last_synced_at).toLocaleString()
                          : 'Never'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => syncItem(item.item_id)}
                            disabled={syncingId === item.item_id}
                          >
                            {syncingId === item.item_id ? 'Syncing…' : '🔄 Sync'}
                          </button>
                          {reAuthItemId === item.item_id && !reAuthToken && (
                            <button
                              className="btn btn-sm btn-warning"
                              onClick={() => startReAuth(item.item_id)}
                            >
                              🔑 Re-authenticate
                            </button>
                          )}
                          {reAuthToken && reAuthItemId === item.item_id && (
                            <PlaidLinkButton
                              linkToken={reAuthToken}
                              accountId={null}
                              onSuccess={(result, err) => {
                                if (err) { notify(err, 'error'); setReAuthToken(null); return; }
                                onReAuthSuccess(null, null);
                              }}
                              onExit={() => setReAuthToken(null)}
                              isOAuthReturn={false}
                            />
                          )}
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => removeItem(item.item_id, item.institution_name)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── AI Recategorize ── */}
      <div className="card" style={{ marginTop: '2rem' }}>
        <div className="card-header">
          <h2 className="card-title">🤖 AI Re-categorization</h2>
        </div>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <p style={{ color: 'var(--text-secondary)', margin: 0, flex: 1 }}>
            Re-run AI categorization on all uncategorized transactions. Also applies your corrections — transactions similar to ones you've already categorized will inherit that category.
          </p>
          <button
            className="btn btn-secondary"
            onClick={recategorizeAll}
            disabled={recategorizing}
            style={{ whiteSpace: 'nowrap' }}
          >
            {recategorizing ? '⏳ Working…' : '🔁 Recategorize All'}
          </button>
        </div>
      </div>
    </div>
  );
}
