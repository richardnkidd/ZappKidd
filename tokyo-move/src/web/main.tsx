import '@fontsource-variable/inter/index.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/noto-serif-jp/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/pages.css';
import './styles/gantt.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, storedTheme } from './state/prefs';

applyTheme(storedTheme());
const el = document.getElementById('root');
if (!el) throw new Error('Missing #root');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
