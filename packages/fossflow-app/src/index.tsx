import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';
import { applyDesignTokens, fontsReady } from './designTokens';
import 'react-quill-new/dist/quill.snow.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import { ErrorBoundary } from 'react-error-boundary';
import ErrorBoundaryFallbackUI from './components/ErrorBoundary';
import {I18nextProvider} from 'react-i18next';
import i18n from './i18n';

applyDesignTokens();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
// Wait briefly for Geist so canvas text boxes are measured with the real font.
void fontsReady()
  .catch(() => undefined)
  .finally(() => {
    root.render(
      <React.StrictMode>
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary FallbackComponent={ErrorBoundaryFallbackUI}>
            <App />
          </ErrorBoundary>
        </I18nextProvider>
      </React.StrictMode>
    );
  });

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

// Service worker registration - only in production for PWA functionality
if (process.env.NODE_ENV === 'production') {
  serviceWorkerRegistration.register({
    onSuccess: () => console.log('Service worker registered successfully'),
    onUpdate: () => console.log('Service worker update available')
  });
} else {
  // Disable service worker in development to avoid cache issues
  serviceWorkerRegistration.unregister();
}
