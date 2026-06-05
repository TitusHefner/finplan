import React, { useState, useEffect } from 'react';
import axios from '../api';

function TransactionEntry() {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  // Form state
  const [formData, setFormData] = useState({
    account_id: '',
    category_id: '',
    amount: '',
    description: '',
    transaction_type: 'expense',
    transaction_date: new Date().toISOString().split('T')[0],
    is_recurring: false,
    recurring_frequency: 'monthly',
    recurring_day: '',
    recurring_start_date: new Date().toISOString().split('T')[0],
    tags: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [transactionsRes, accountsRes, categoriesRes] = await Promise.all([
        axios.get('/api/transactions'),
        axios.get('/api/accounts'),
        axios.get('/api/categories')
      ]);

      setTransactions(transactionsRes.data);
      setAccounts(accountsRes.data);
      setCategories(categoriesRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const transactionData = {
        ...formData,
        amount: parseFloat(formData.amount),
        account_id: parseInt(formData.account_id),
        category_id: formData.category_id ? parseInt(formData.category_id) : null,
        transaction_date: new Date(formData.transaction_date).toISOString(),
        tags: formData.tags || null,
        recurring_frequency: formData.is_recurring ? formData.recurring_frequency : null,
        recurring_day: formData.is_recurring && formData.recurring_frequency === 'monthly' && formData.recurring_day
          ? parseInt(formData.recurring_day) : null,
        recurring_start_date: formData.is_recurring && ['weekly', 'bi-weekly'].includes(formData.recurring_frequency) && formData.recurring_start_date
          ? new Date(formData.recurring_start_date).toISOString() : null,
      };

      const response = await axios.post('/api/transactions', transactionData);
      setTransactions(prev => [response.data, ...prev]);

      // Reset form
      setFormData({
        account_id: '',
        category_id: '',
        amount: '',
        description: '',
        transaction_type: 'expense',
        transaction_date: new Date().toISOString().split('T')[0],
        is_recurring: false,
        recurring_frequency: 'monthly',
        recurring_day: '',
        recurring_start_date: new Date().toISOString().split('T')[0],
        tags: ''
      });
    } catch (error) {
      console.error('Error creating transaction:', error);
      alert('Error creating transaction. Please try again.');
    }
  };

  const filteredCategories = categories.filter(cat =>
    formData.transaction_type === 'income' ? cat.is_income : !cat.is_income
  );

  const toggleTransfer = async (txId) => {
    setTogglingId(txId);
    try {
      const res = await axios.post(`/api/transactions/${txId}/toggle-transfer`);
      setTransactions(prev => prev.map(t =>
        t.id === txId ? { ...t, transaction_type: res.data.transaction_type } : t
      ));
    } catch (err) {
      console.error('Toggle transfer failed:', err);
    } finally {
      setTogglingId(null);
    }
  };

  const deleteTransaction = async (txId, description) => {
    if (!window.confirm(`Delete "${description}"? This cannot be undone.`)) return;
    setDeletingId(txId);
    try {
      await axios.delete(`/api/transactions/${txId}`);
      setTransactions(prev => prev.filter(t => t.id !== txId));
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete transaction.');
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (tx) => {
    setEditingId(tx.id);
    setEditDraft({
      transaction_type: tx.transaction_type?.toLowerCase() ?? 'expense',
      category_id: tx.category_id ?? '',
      description: tx.description ?? '',
      amount: Math.abs(tx.amount),
    });
  };

  const saveEdit = async (txId) => {
    try {
      const payload = {
        transaction_type: editDraft.transaction_type,
        category_id: editDraft.category_id !== '' ? parseInt(editDraft.category_id) : null,
        description: editDraft.description,
        amount: editDraft.transaction_type === 'expense' || editDraft.transaction_type === 'transfer'
          ? -Math.abs(parseFloat(editDraft.amount))
          : Math.abs(parseFloat(editDraft.amount)),
      };
      const res = await axios.patch(`/api/transactions/${txId}`, payload);
      setTransactions(prev => prev.map(t => t.id === txId ? res.data : t));
      setEditingId(null);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save changes.');
    }
  };

  const detectTransfers = async () => {
    if (!window.confirm('Auto-detect matching transfers between accounts? This will re-classify matching transactions as transfers.')) return;
    setDetecting(true);
    try {
      const res = await axios.post('/api/transactions/detect-transfers');
      alert(`Done — ${res.data.pairs_detected} transfer pair${res.data.pairs_detected !== 1 ? 's' : ''} detected (${res.data.transactions_marked} transactions marked).`);
      await loadData();
    } catch (err) {
      console.error('Detect transfers failed:', err);
      alert('Failed to detect transfers. See console for details.');
    } finally {
      setDetecting(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="loading-spinner"></div> Loading...</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <header style={{ marginBottom: '30px' }}>
        <h1>Transaction Management</h1>
        <p>Track your income and expenses with detailed categorization</p>
      </header>

      {/* Transaction Form */}
      <div style={{ marginBottom: '40px' }}>
        <h2>Add New Transaction</h2>
        <form onSubmit={handleSubmit} style={{
          background: 'white',
          padding: '24px',
          borderRadius: '12px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e1e8ed'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            {/* Transaction Type */}
            <div className="form-group">
              <label>Type</label>
              <select
                name="transaction_type"
                value={formData.transaction_type}
                onChange={handleInputChange}
                required
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>

            {/* Account */}
            <div className="form-group">
              <label>Account</label>
              <select
                name="account_id"
                value={formData.account_id}
                onChange={handleInputChange}
                required
              >
                <option value="">Select Account</option>
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div className="form-group">
              <label>Category</label>
              <select
                name="category_id"
                value={formData.category_id}
                onChange={handleInputChange}
              >
                <option value="">Select Category (Optional)</option>
                {filteredCategories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.01"
                required
              />
            </div>

            {/* Date */}
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                name="transaction_date"
                value={formData.transaction_date}
                onChange={handleInputChange}
                required
              />
            </div>

            {/* Description */}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Description</label>
              <input
                type="text"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Transaction description"
                required
              />
            </div>

            {/* Tags */}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Tags (Optional)</label>
              <input
                type="text"
                name="tags"
                value={formData.tags}
                onChange={handleInputChange}
                placeholder="e.g., groceries, dining, work"
              />
            </div>

            {/* Recurring */}
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                name="is_recurring"
                checked={formData.is_recurring}
                onChange={handleInputChange}
                id="is_recurring"
              />
              <label htmlFor="is_recurring" style={{ margin: 0, cursor: 'pointer' }}>
                Recurring Transaction
              </label>
            </div>

            {formData.is_recurring && (
              <>
                <div className="form-group">
                  <label>Frequency</label>
                  <select name="recurring_frequency" value={formData.recurring_frequency} onChange={handleInputChange}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly (calendar date)</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>

                {formData.recurring_frequency === 'monthly' && (
                  <div className="form-group">
                    <label>Day of month (e.g. 12 = 12th of every month)</label>
                    <input
                      type="number"
                      name="recurring_day"
                      value={formData.recurring_day}
                      onChange={handleInputChange}
                      min="1"
                      max="31"
                      placeholder="1–31"
                    />
                  </div>
                )}

                {['weekly', 'bi-weekly'].includes(formData.recurring_frequency) && (
                  <div className="form-group">
                    <label>Starts on (anchor date)</label>
                    <input
                      type="date"
                      name="recurring_start_date"
                      value={formData.recurring_start_date}
                      onChange={handleInputChange}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button type="submit" className="btn btn-primary">
              Add Transaction
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setFormData({
                account_id: '',
                category_id: '',
                amount: '',
                description: '',
                transaction_type: 'expense',
                transaction_date: new Date().toISOString().split('T')[0],
                is_recurring: false,
                recurring_frequency: 'monthly',
                recurring_day: '',
                recurring_start_date: new Date().toISOString().split('T')[0],
                tags: ''
              })}
            >
              Clear Form
            </button>
          </div>
        </form>
      </div>

      {/* Recent Transactions */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Recent Transactions</h2>
          <button
            className="btn btn-secondary"
            onClick={detectTransfers}
            disabled={detecting}
            title="Find matching inter-account transfers and mark them so they don't double-count income/expenses"
          >
            {detecting ? '🔍 Detecting…' : '🔍 Auto-Detect Transfers'}
          </button>
        </div>
        {transactions.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: '#7f8c8d',
            background: 'white',
            borderRadius: '8px',
            border: '1px solid #e1e8ed'
          }}>
            <p>No transactions yet.</p>
            <p>Add your first transaction above to get started!</p>
          </div>
        ) : (
          <div style={{ background: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#2c3e50' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#2c3e50' }}>Description</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#2c3e50' }}>Category</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#2c3e50' }}>Account</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '600', color: '#2c3e50' }}>Amount</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#2c3e50' }}>Type</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#2c3e50' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 50).map(transaction => {
                  const isEditing  = editingId === transaction.id;
                  const isTransfer = transaction.transaction_type === 'transfer' || transaction.transaction_type === 'TRANSFER';
                  const isIncome   = transaction.transaction_type === 'income'   || transaction.transaction_type === 'INCOME';
                  const busy = togglingId === transaction.id || deletingId === transaction.id;

                  if (isEditing) {
                    const draftIsIncome = editDraft.transaction_type === 'income';
                    const filteredCats = categories.filter(c =>
                      editDraft.transaction_type === 'income' ? c.is_income : !c.is_income
                    );
                    return (
                      <tr key={transaction.id} style={{ borderBottom: '2px solid #3498db', background: '#eaf3fb' }}>
                        <td style={{ padding: '10px 16px', color: '#7f8c8d', fontSize: 13 }}>
                          {new Date(transaction.transaction_date).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input
                            style={{ width: '100%', padding: '4px 8px', borderRadius: 5, border: '1px solid #aed6f1', fontSize: 13 }}
                            value={editDraft.description}
                            onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                          />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <select
                            style={{ width: '100%', padding: '4px 8px', borderRadius: 5, border: '1px solid #aed6f1', fontSize: 13 }}
                            value={editDraft.category_id}
                            onChange={e => setEditDraft(d => ({ ...d, category_id: e.target.value }))}
                          >
                            <option value="">Uncategorized</option>
                            {filteredCats.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <select
                            style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #aed6f1', fontSize: 13, width: '100%' }}
                            value={editDraft.transaction_type}
                            onChange={e => setEditDraft(d => ({ ...d, transaction_type: e.target.value, category_id: '' }))}
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                            <option value="transfer">Transfer</option>
                          </select>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            style={{ width: 90, padding: '4px 8px', borderRadius: 5, border: '1px solid #aed6f1', fontSize: 13, textAlign: 'right' }}
                            value={editDraft.amount}
                            onChange={e => setEditDraft(d => ({ ...d, amount: e.target.value }))}
                          />
                        </td>
                        <td colSpan={2} style={{ padding: '6px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => saveEdit(transaction.id)}
                            style={{ marginRight: 6, padding: '4px 14px', borderRadius: 6, border: 'none', background: '#27ae60', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                          >✓ Save</button>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #bdc3c7', background: 'white', cursor: 'pointer', fontSize: 13 }}
                          >Cancel</button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={transaction.id} style={{
                      borderBottom: '1px solid #e1e8ed',
                      opacity: isTransfer ? 0.55 : 1,
                      background: isTransfer ? '#f8f9fa' : undefined,
                    }}>
                      <td style={{ padding: '12px 16px' }}>
                        {new Date(transaction.transaction_date).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {transaction.description}
                        {transaction.is_recurring && <span style={{ color: '#f39c12', marginLeft: '8px' }}>↻</span>}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {transaction.category_id ?
                          categories.find(c => c.id === transaction.category_id)?.name || 'Unknown' :
                          <span style={{ color: '#95a5a6' }}>Uncategorized</span>
                        }
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {accounts.find(a => a.id === transaction.account_id)?.name || 'Unknown'}
                      </td>
                      <td style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: isTransfer ? '#95a5a6' : isIncome ? '#27ae60' : '#e74c3c',
                      }}>
                        {isTransfer ? '⇄' : isIncome ? '+' : '−'}${Math.abs(transaction.amount).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                        <button
                          onClick={() => toggleTransfer(transaction.id)}
                          disabled={busy}
                          title={isTransfer ? 'Unmark as transfer' : 'Mark as transfer (exclude from totals)'}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            border: '1px solid',
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: isTransfer ? '#ecf0f1' : 'transparent',
                            borderColor: isTransfer ? '#bdc3c7' : '#d0d0d0',
                            color: isTransfer ? '#7f8c8d' : '#555',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {togglingId === transaction.id ? '…' : isTransfer ? '⇄ Transfer' : 'Mark transfer'}
                        </button>
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => startEdit(transaction)}
                          disabled={busy}
                          title="Edit this transaction"
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            border: '1px solid #3498db',
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: 'transparent',
                            color: '#3498db',
                            marginRight: 4,
                          }}
                        >✏️ Edit</button>
                        <button
                          onClick={() => deleteTransaction(transaction.id, transaction.description)}
                          disabled={busy}
                          title="Delete this transaction"
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            border: '1px solid #e74c3c',
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: 'transparent',
                            color: '#e74c3c',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {deletingId === transaction.id ? '…' : '🗑 Delete'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransactionEntry;