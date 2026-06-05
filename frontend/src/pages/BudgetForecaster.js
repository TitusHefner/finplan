import React, { useEffect, useState } from 'react';
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

function BudgetForecaster() {
  const [dailyBudget, setDailyBudget] = useState([]);

  useEffect(() => {
    axios.get('/api/forecasts/daily-budget').then(res => setDailyBudget(res.data.daily_budget));
  }, []);

  const data = {
    labels: dailyBudget.map(d => `Day ${d.day}`),
    datasets: [
      {
        label: 'Daily Spending',
        data: dailyBudget.map(d => d.spending),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
      },
      {
        label: 'Balance',
        data: dailyBudget.map(d => d.balance),
        borderColor: 'rgb(53, 162, 235)',
        backgroundColor: 'rgba(53, 162, 235, 0.5)',
      },
    ],
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Budget Forecaster</h2>
      <Line data={data} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Day</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Spending</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {dailyBudget.map(d => (
            <tr key={d.day}>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{d.day}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>${d.spending.toFixed(2)}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>${d.balance.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default BudgetForecaster;