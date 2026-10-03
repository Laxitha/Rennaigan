import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { MatrixRain } from '@/components/background/MatrixRain'
import { AppShell } from '@/components/navigation/AppShell'
import { ErrorState, ForensicLoader, GlassButton } from '@/components/glass'

// Route-level code splitting: each page ships as its own chunk.
const Landing = lazy(() => import('@/pages/Landing'))
const Overview = lazy(() => import('@/pages/Overview'))
const Investigations = lazy(() => import('@/pages/Investigations'))
const Analyze = lazy(() => import('@/pages/Analyze'))
const Analysis = lazy(() => import('@/pages/Analysis'))
const Timeline = lazy(() => import('@/pages/Timeline'))
const Evidence = lazy(() => import('@/pages/Evidence'))
const Verification = lazy(() => import('@/pages/Verification'))
const Report = lazy(() => import('@/pages/Report'))
const Audit = lazy(() => import('@/pages/Audit'))
const Bulk = lazy(() => import('@/pages/Bulk'))
const Cases = lazy(() => import('@/pages/Cases'))
const Review = lazy(() => import('@/pages/Review'))
const Models = lazy(() => import('@/pages/Models'))
const Settings = lazy(() => import('@/pages/Settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))

/** Users never see a stack trace: render failures land on a calm error state. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="relative z-10 flex min-h-dvh items-center justify-center p-6">
        <div className="glass w-full max-w-lg" data-level="3">
          <ErrorState title="Workspace interrupted" body="This view could not be displayed. Your investigations and evidence are unaffected."
            onRetry={() => this.setState({ error: null })} secondary={<GlassButton onClick={() => window.location.assign('/overview')}>Go to overview</GlassButton>} />
        </div>
      </div>
    )
  }
}

export function App() {
  return (
    <>
      <MatrixRain />
      <Boundary>
        <Suspense fallback={<div className="relative z-10"><ForensicLoader className="min-h-dvh" /></div>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route element={<AppShell />}>
              <Route path="/overview" element={<Overview />} />
              <Route path="/investigations" element={<Investigations />} />
              <Route path="/analyze" element={<Analyze />} />
              <Route path="/analysis" element={<Analysis />} />
              <Route path="/analysis/:id" element={<Analysis />} />
              <Route path="/timeline" element={<Timeline />} />
              <Route path="/timeline/:id" element={<Timeline />} />
              <Route path="/evidence" element={<Evidence />} />
              <Route path="/evidence/:id" element={<Evidence />} />
              <Route path="/verification" element={<Verification />} />
              <Route path="/verification/:id" element={<Verification />} />
              <Route path="/reports" element={<Report />} />
              <Route path="/reports/:id" element={<Report />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/audit/:id" element={<Audit />} />
              <Route path="/bulk" element={<Bulk />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/review" element={<Review />} />
              <Route path="/review/:id" element={<Review />} />
              <Route path="/models" element={<Models />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </Boundary>
    </>
  )
}
