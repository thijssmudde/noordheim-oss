'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  configureAnalytics,
  readAnalyticsConsent,
  saveAnalyticsConsent,
  subscribeAnalyticsConsent,
  trackPageView,
} from '@/lib/analytics';
import './analytics.css';

export function Analytics({ measurementId }: { measurementId: string }) {
  const consent = useSyncExternalStore(
    subscribeAnalyticsConsent,
    readAnalyticsConsent,
    () => null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    configureAnalytics(measurementId, consent ?? 'denied');
    if (consent !== 'granted') {
      lastPage.current = null;
      return;
    }
    if (lastPage.current !== pathname) {
      trackPageView(measurementId);
      lastPage.current = pathname;
    }
  }, [consent, measurementId, pathname]);

  if (consent && !settingsOpen) {
    return (
      <button
        className="analytics-settings"
        onClick={() => setSettingsOpen(true)}
      >
        Cookie settings
      </button>
    );
  }

  return (
    <section className="analytics-consent" aria-label="Analytics cookies">
      <div>
        <strong>Help improve Noordheim</strong>
        <p>
          Allow Google Analytics cookies to measure visits and page views? Your
          choice won’t affect the game. You can change it in Cookie settings.
        </p>
      </div>
      <div className="analytics-actions">
        <button
          onClick={() => {
            saveAnalyticsConsent('denied');
            setSettingsOpen(false);
          }}
        >
          Reject
        </button>
        <button
          onClick={() => {
            saveAnalyticsConsent('granted');
            setSettingsOpen(false);
          }}
        >
          Allow analytics
        </button>
        {consent && (
          <button onClick={() => setSettingsOpen(false)}>Close</button>
        )}
      </div>
    </section>
  );
}
