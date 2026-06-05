import React, { useEffect, useState } from 'react';
import axios from '../api';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

function FinancialOverview() {
  const [expenses, setExpenses] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);

  useEffect(() => {
    axios.get('/api/expenses').then(res => setExpenses(res.data));
    axios.get('/api/incomes').then(res => setIncomes(res.data));
    axios.get('/api/fixed-expenses').then(res => setFixedExpenses(res.data));
  }, []);

  const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0) + fixedExpenses.reduce((sum, f) => sum + f.amount, 0);
  const net = totalIncome - totalExpenses;

  const data = {
    labels: ['Income', 'Expenses', 'Net'],
    datasets: [{
      label: 'Amount',
      data: [totalIncome, totalExpenses, net],
      backgroundColor: ['green', 'red', 'blue'],
    }],
  };

  return (
    <div>
      <h2>Financial Overview</h2>
      <Bar data={data} />
    </div>
  );
}

export default FinancialOverview;