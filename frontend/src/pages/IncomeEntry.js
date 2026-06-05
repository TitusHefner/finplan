import React, { useState, useEffect } from 'react';
import axios from '../api';

function IncomeEntry() {
  const [incomes, setIncomes] = useState([]);
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [recurringDay, setRecurringDay] = useState('');
  const [startDate, setStartDate] = useState('');

  useEffect(() => {
    axios.get('/api/incomes').then(res => setIncomes(res.data));
  }, []);

  useEffect(() => {
    if (frequency !== 'monthly') {
      setRecurringDay('');
    }
    if (frequency !== 'bi-weekly') {
      setStartDate('');
    }
  }, [frequency]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const startDateValue = startDate ? `${startDate}T00:00:00` : null;
    axios.post('/api/incomes', { source, amount: parseFloat(amount), frequency, recurring_day: recurringDay ? parseInt(recurringDay) : null, start_date: startDateValue })
      .then(response => {
        setIncomes([...incomes, response.data]);
        setSource('');
        setAmount('');
        setFrequency('monthly');
        setRecurringDay('');
        setStartDate('');
      })
      .catch(error => console.error(error));
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Income Entry</h2>
      <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
        <input type="text" placeholder="Source" value={source} onChange={e => setSource(e.target.value)} required />
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
        {frequency === 'bi-weekly' && (
          <input type="date" placeholder="Start Date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        )}
        <button type="submit">Add Income</button>
      </form>
      <ul>
        {incomes.map(i => <li key={i.id}>{i.source}: ${i.amount} ({i.frequency}{i.recurring_day ? ` on ${i.recurring_day}` : ''}{i.start_date ? ` starting ${i.start_date.split('T')[0]}` : ''})</li>)}
      </ul>
    </div>
  );
}

export default IncomeEntry;