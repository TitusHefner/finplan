import React, { useState, useEffect } from 'react';
import axios from '../api';

function FixedCostEntry() {
  const [fixedCosts, setFixedCosts] = useState([]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [recurringDay, setRecurringDay] = useState('');

  useEffect(() => {
    axios.get('/api/fixed-expenses').then(res => setFixedCosts(res.data));
  }, []);

  useEffect(() => {
    if (frequency !== 'monthly') {
      setRecurringDay('');
    }
  }, [frequency]);

  const handleSubmit = (e) => {
    e.preventDefault();
    axios.post('/api/fixed-expenses', { name, amount: parseFloat(amount), frequency, recurring_day: recurringDay ? parseInt(recurringDay) : null })
      .then(response => {
        setFixedCosts([...fixedCosts, response.data]);
        setName('');
        setAmount('');
        setFrequency('monthly');
        setRecurringDay('');
      })
      .catch(error => console.error(error));
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Fixed Cost Entry</h2>
      <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
        <input type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)} required />
        <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required />
        <select value={frequency} onChange={e => setFrequency(e.target.value)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="bi-weekly">Bi-weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        {frequency === 'monthly' && (
          <input type="number" placeholder="Recurring Day (e.g., 4 for 4th of month)" value={recurringDay} onChange={e => setRecurringDay(e.target.value)} />
        )}
        <button type="submit">Add Fixed Cost</button>
      </form>
      <ul>
        {fixedCosts.map(f => <li key={f.id}>{f.name}: ${f.amount} ({f.frequency}{f.recurring_day ? ` on ${f.recurring_day}` : ''})</li>)}
      </ul>
    </div>
  );
}

export default FixedCostEntry;