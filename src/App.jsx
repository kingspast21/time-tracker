import React, { useState, useCallback, useEffect } from 'react';
import WeekPage from './components/WeekPage';
import ClientsPage from './components/ClientsPage';
import SettingsPage from './components/SettingsPage';

export default function App() {
  const [page, setPage] = useState('week');
  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState(null);

  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { window.api.getSettings().then(setSettings); }, [page]);

  const pages = [
    { id: 'week', label: 'This week' },
    { id: 'clients', label: 'Clients' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">TimeTracker</div>
        {pages.map(p => (
          <button key={p.id} className={`sidebar-btn ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)}>
            {p.label}
          </button>
        ))}
        {settings && <div className="sidebar-foot">{settings.your_name}</div>}
      </nav>
      <main className="main-content">
        {page === 'week' && <WeekPage showToast={showToast} settings={settings} goSettings={() => setPage('settings')} />}
        {page === 'clients' && <ClientsPage showToast={showToast} />}
        {page === 'settings' && <SettingsPage showToast={showToast} />}
      </main>
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
