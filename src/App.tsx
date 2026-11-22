import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Atmosphere } from '@/components/layout/Atmosphere';
import { NavBar } from '@/components/layout/NavBar';
import { Footer } from '@/components/layout/Footer';
import { RouteFallback } from '@/components/layout/RouteFallback';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { NotFound } from '@/pages/NotFound';
import { Home } from '@/pages/Home';

// Route-level code splitting keeps the first paint on the homepage light.
const Explore = lazy(() => import('@/pages/Explore').then((m) => ({ default: m.Explore })));
const Predictions = lazy(() =>
  import('@/pages/Predictions').then((m) => ({ default: m.Predictions })),
);
const PredictionRecordPage = lazy(() =>
  import('@/pages/PredictionRecordPage').then((m) => ({ default: m.PredictionRecordPage })),
);
const Trends = lazy(() => import('@/pages/Trends').then((m) => ({ default: m.Trends })));
const About = lazy(() => import('@/pages/About').then((m) => ({ default: m.About })));

/** Move focus to the page heading on navigation, and reset scroll. */
function RouteEffects() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    const heading = document.querySelector<HTMLElement>('#main h1, #main h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }, [pathname, hash]);

  return null;
}

export function App() {
  return (
    <>
      <Atmosphere />
      <RouteEffects />
      <NavBar />
      <main id="main" className="main" tabIndex={-1}>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/predictions" element={<Predictions />} />
              <Route path="/predictions/:id" element={<PredictionRecordPage />} />
              <Route path="/trends" element={<Trends />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </>
  );
}
