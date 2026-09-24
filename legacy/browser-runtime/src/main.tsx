import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the PWA service worker for Android/desktop offline support.
//
// public/sw.js is copied verbatim into the build by Vite, so /sw.js actually exists - it did
// not before the public/ directory was added, and this registration 404'd in every production
// build, which is why offline support never worked. The worker itself is network-first for
// navigations and the app shell so an updated z-30 is what loads; see public/sw.js.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed; offline support is unavailable:', err);
    });
  });
}
