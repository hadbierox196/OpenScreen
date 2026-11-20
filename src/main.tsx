import { createRoot } from 'react-dom/client';
import './style.css';
import App from './App';
try {
  const t = localStorage.getItem('openscreen.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
} catch { document.documentElement.dataset.theme = 'light'; }
createRoot(document.getElementById('root')!).render(<App />);
