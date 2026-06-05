import React, { useEffect, useState } from 'react';
import axios from '../api';

function PlanningDashboard() {
  const [budgets, setBudgets] = useState([]);

  useEffect(() => {
    axios.get('/api/budgets').then(res => setBudgets(res.data));
  }, []);

  return (
    <div>
      <h2>Planning Dashboard</h2>
      <ul>
        {budgets.map(b => <li key={b.id}>{b.category}: ${b.amount} ({b.period})</li>)}
      </ul>
    </div>
  );
}

export default PlanningDashboard;