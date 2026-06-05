import React, { useEffect, useState } from 'react';
import axios from '../api';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Pie } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

function SpendingDashboard() {
  const [expenses, setExpenses] = useState([]);

  useEffect(() => {
    axios.get('/api/expenses').then(res => setExpenses(res.data));
  }, []);

  const categoryTotals = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {});

  const data = {
    labels: Object.keys(categoryTotals),
    datasets: [{
      data: Object.values(categoryTotals),
      backgroundColor: ['red', 'blue', 'yellow', 'green'],
    }],
  };

  return (
    <div>
      <h2>Spending Dashboard</h2>
      <Pie data={data} />
    </div>
  );
}

export default SpendingDashboard;