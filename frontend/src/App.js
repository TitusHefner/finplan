import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import './App.css';
import Dashboard from './pages/Dashboard';
import MobileApp from './pages/mobile/MobileApp';
import BudgetForecaster from './pages/BudgetForecaster';
import TransactionEntry from './pages/TransactionEntry';
import BankConnect from './pages/BankConnect';
import ChatAdvisor from './pages/ChatAdvisor';
import BudgetManager from './pages/BudgetManager';
import CategoryManager from './pages/CategoryManager';
import BalanceTracker from './pages/BalanceTracker';
import RecurringManager from './pages/RecurringManager';

// Navigation Component
function Navigation() {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/balance', label: 'Balance', icon: '💵' },
    { path: '/recurring', label: 'Recurring', icon: '🔁' },
    { path: '/transactions', label: 'Transactions', icon: '📝' },
    { path: '/connect', label: 'Bank Connect', icon: '🏦' },
    { path: '/budgets', label: 'Budgets', icon: '🎯' },
    { path: '/categories', label: 'Categories', icon: '🏷️' },
    { path: '/chat', label: 'AI Advisor', icon: '🤖' },
    { path: '/mobile', label: 'Mobile Preview', icon: '📱' }
  ];

  return (
    <nav className="main-nav">
      <div className="nav-brand">
        <h2>💰 SmartBudget Pro</h2>
        <span className="nav-subtitle">Personal Finance Management</span>
      </div>
      <ul className="nav-links">
        {navItems.map(item => (
          <li key={item.path}>
            <Link
              to={item.path}
              className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="nav-footer">
        <div className="user-status">
          <div className="status-indicator online"></div>
          <span>Connected</span>
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <Navigation />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/budgetforecast" element={<BudgetForecaster />} />
            <Route path="/balance" element={<BalanceTracker />} />
            <Route path="/recurring" element={<RecurringManager />} />
            <Route path="/transactions" element={<TransactionEntry />} />
            <Route path="/connect" element={<BankConnect />} />
            <Route path="/bank-connect" element={<BankConnect />} />
            <Route path="/budgets" element={<BudgetManager />} />
            <Route path="/categories" element={<CategoryManager />} />
            <Route path="/chat" element={<ChatAdvisor />} />
            <Route path="/mobile" element={<MobileApp />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;