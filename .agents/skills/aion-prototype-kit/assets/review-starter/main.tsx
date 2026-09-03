import React from 'react';
import { createRoot } from 'react-dom/client';
import '@arco-design/web-react/dist/css/arco.css';
import { ReviewStarter } from './ReviewStarter';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReviewStarter />
  </React.StrictMode>
);
