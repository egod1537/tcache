import { createRoot } from 'react-dom/client';

import '@blueprintjs/core/lib/css/blueprint.css';
import { App } from './app/App';
import {
  applyDocumentTheme,
  getInitialThemeMode,
  resolveTheme,
} from './theme/theme';
import './styles/index.css';

const initialThemeMode = getInitialThemeMode();
applyDocumentTheme(resolveTheme(initialThemeMode));

createRoot(document.getElementById('root')!).render(
  <App initialThemeMode={initialThemeMode} />,
);
