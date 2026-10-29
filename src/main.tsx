import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyStoredTheme } from './hooks/useTheme';
import './index.css';

applyStoredTheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
