export type AnalyticsConsent = 'granted' | 'denied';

const STORAGE_KEY = 'noordheim.analytics-consent.v1';
const CHANGE_EVENT = 'noordheim-analytics-consent';
let temporaryConsent: AnalyticsConsent | null = null;
let storageUnavailable = false;
let initialized = false;

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (storageUnavailable) return temporaryConsent;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return temporaryConsent;
  }
}

export function subscribeAnalyticsConsent(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function saveAnalyticsConsent(consent: AnalyticsConsent) {
  temporaryConsent = consent;
  try {
    localStorage.setItem(STORAGE_KEY, consent);
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    // The choice still applies for this visit when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// Checkout session IDs, recovery keys and arbitrary query parameters must not
// become analytics data. Retain only campaign attribution on the landing URL.
export function analyticsPageUrl(href: string) {
  const url = new URL(href);
  const query = new URLSearchParams();
  for (const name of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
  ]) {
    const value = url.searchParams.get(name);
    if (value) query.set(name, value);
  }
  url.search = query.toString();
  url.hash = '';
  return url.href;
}

export function configureAnalytics(
  measurementId: string,
  consent: AnalyticsConsent,
) {
  const target = window as AnalyticsWindow;
  // This disables collection immediately, including after consent is withdrawn.
  (window as unknown as Record<string, unknown>)[
    `ga-disable-${measurementId}`
  ] = consent !== 'granted';
  if (consent !== 'granted') {
    target.gtag?.('consent', 'update', { analytics_storage: 'denied' });
    return;
  }
  if (initialized) {
    target.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  initialized = true;
  target.dataLayer ??= [];
  target.gtag = function () {
    // Google's command queue expects the gtag arguments object.
    // eslint-disable-next-line prefer-rest-params
    target.dataLayer!.push(arguments);
  };
  target.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  target.gtag('js', new Date());
  target.gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: analyticsPageUrl(window.location.href),
    page_referrer: document.referrer ? new URL(document.referrer).origin : '',
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
}

export function trackPageView(measurementId: string) {
  if (readAnalyticsConsent() !== 'granted') return;
  (window as AnalyticsWindow).gtag?.('set', {
    page_location: analyticsPageUrl(window.location.href),
    page_referrer: document.referrer ? new URL(document.referrer).origin : '',
  });
  (window as AnalyticsWindow).gtag?.('event', 'page_view', {
    send_to: measurementId,
    page_location: analyticsPageUrl(window.location.href),
    page_title: document.title,
    page_referrer: document.referrer ? new URL(document.referrer).origin : '',
  });
}
