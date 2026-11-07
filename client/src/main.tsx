// CSS toàn app phải nạp trước mọi component để khai báo thứ tự @layer đứng đầu bundle
import './styles/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './store.js';
import App from './App.js';
// Font tự host (không tải từ Google Fonts): không lộ IP người chơi cho bên thứ ba và CSP chặt hơn
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
