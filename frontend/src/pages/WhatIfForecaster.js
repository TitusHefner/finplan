import React, { useState } from 'react';
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
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

function WhatIfForecaster() {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [impacts, setImpacts] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    axios.post('/api/forecasts/what-if', { purchase_amount: parseFloat(amount), category })
      .then(res => setImpacts(res.data.impact))
      .catch(err => console.error(err));
  };

  const data = {
    labels: impacts.map(i => `Day ${i.day}`),
    datasets: [{
      label: 'Impact Over Time',
      data: impacts.map(i => i.impact),
      borderColor: 'rgb(255, 99, 132)',
      backgroundColor: 'rgba(255, 99, 132, 0.5)',
    }],
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>What-If Purchase Forecaster</h2>
      <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
        <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required />
        <input type="text" placeholder="Category" value={category} onChange={e => setCategory(e.target.value)} required />
        <button type="submit">Simulate</button>
      </form>
      {impacts.length > 0 && <Line data={data} />}
    </div>
  );
}

export default WhatIfForecaster;