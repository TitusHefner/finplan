import React, { useState, useEffect } from 'react';
import axios from '../../api';
import './mobile.css';
import MobileDashboard from './MobileDashboard';
import MobileTransactions from './MobileTransactions';
import MobileBudgets from './MobileBudgets';
import MobileAccounts from './MobileAccounts';
import PlaidConnect from './PlaidConnect';
import CategoryReview from './CategoryReview';
import MobileChat from './MobileChat';

const TABS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '📊' },
  { id: 'transactions', label: 'Transactions',  icon: '📋' },
  { id: 'budgets',      label: 'Budgets',       icon: '🎯' },
  { id: 'accounts',     label: 'Accounts',      icon: '💳' },
  { id: 'review',       label: 'Review',        icon: '🤖' },
  { id: 'chat',         label: 'Advisor',       icon: '💬' },
  { id: 'connect',      label: 'Connect',       icon: '🏦' },
];

export default function MobileApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardKey, setDashboardKey] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  // Poll the review badge count when the component mounts
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await axios.get('/api/mobile/review/count');
        setReviewCount(res.data.pending ?? 0);
      } catch {
        /* badge is non-critical */
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleTransactionAdded = () => {
    if (activeTab === 'dashboard') setDashboardKey((k) => k + 1);
    // A new manually-entered transaction may have been auto-categorised
    refreshReviewCount();
  };

  const refreshReviewCount = async () => {
    try {
      const res = await axios.get('/api/mobile/review/count');
      setReviewCount(res.data.pending ?? 0);
    } catch {}
  };

  return (
    <div className="mobile-app">
      {/* Scrollable content */}
      <div className="mobile-content">
        {activeTab === 'dashboard'    && <MobileDashboard key={dashboardKey} />}
        {activeTab === 'transactions' && (
          <MobileTransactions onTransactionAdded={handleTransactionAdded} />
        )}
        {activeTab === 'budgets'      && <MobileBudgets />}
        {activeTab === 'accounts'     && <MobileAccounts />}
        {activeTab === 'review'       && (
          <CategoryReview onReviewComplete={() => {
            setReviewCount(0);
            setDashboardKey((k) => k + 1);
          }} />
        )}
        {activeTab === 'chat'         && (
          <MobileChat />
        )}
        {activeTab === 'connect'      && (
          <PlaidConnect onLinked={() => {
            refreshReviewCount();
            setDashboardKey((k) => k + 1);
          }} />
        )}
      </div>

      {/* iOS-style bottom tab bar */}
      <nav className="mobile-tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`mobile-tab-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={{ position: 'relative' }}
          >
            <span className="mobile-tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.id === 'review' && reviewCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  right: '18%',
                  background: '#ff3b30',
                  color: 'white',
                  borderRadius: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  minWidth: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {reviewCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
