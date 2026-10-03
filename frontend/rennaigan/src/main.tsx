import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@/styles/index.css'
import '@/lib/motion'
import { App } from '@/app/App'
import { PrefsProvider } from '@/hooks/usePrefs'
import { ToastProvider } from '@/components/glass'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PrefsProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </PrefsProvider>
    </BrowserRouter>
  </StrictMode>,
)
