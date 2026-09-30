import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Set the theme attribute before render to avoid a flash of the wrong theme.
const savedTheme = (() => {
  try { return localStorage.getItem('i18n-theme') || 'light' } catch { return 'light' }
})()
document.documentElement.dataset.theme = savedTheme

createRoot(document.getElementById('root')).render(<App />)
