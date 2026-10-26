import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('analytics consent and collection', () => {
  const measurementId = 'G-TEST1234';
  let storage: Map<string, string>;
  let appendChild: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    appendChild = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        location: {
          href: 'https://noordheim.com/sponsor?session_id=private&utm_source=newsletter#secret',
        },
      }),
    );
    vi.stubGlobal('document', {
      title: 'Noordheim',
      referrer: 'https://example.com/private?token=secret',
      createElement: () => ({}),
      head: { appendChild },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not load Google or queue events before consent or after rejection', async () => {
    const analytics = await import('../lib/analytics');
    expect(analytics.readAnalyticsConsent()).toBeNull();
    analytics.configureAnalytics(measurementId, 'denied');
    analytics.trackPageView(measurementId);
    expect(appendChild).not.toHaveBeenCalled();
    expect(
      (window as unknown as { dataLayer?: unknown[] }).dataLayer,
    ).toBeUndefined();
  });

  it('loads once, strips sensitive URLs, and stops page views after withdrawal', async () => {
    const analytics = await import('../lib/analytics');
    analytics.saveAnalyticsConsent('granted');
    analytics.configureAnalytics(measurementId, 'granted');
    analytics.configureAnalytics(measurementId, 'granted');
    analytics.trackPageView(measurementId);
    expect(appendChild).toHaveBeenCalledTimes(1);
    const target = window as unknown as Record<string, unknown> & {
      dataLayer: unknown[][];
    };
    const commands = target.dataLayer.map((command) => Array.from(command));
    expect(commands).toContainEqual([
      'event',
      'page_view',
      {
        send_to: measurementId,
        page_location: 'https://noordheim.com/sponsor?utm_source=newsletter',
        page_title: 'Noordheim',
        page_referrer: 'https://example.com',
      },
    ]);
    expect(JSON.stringify(commands)).not.toContain('secret');
    analytics.saveAnalyticsConsent('denied');
    analytics.configureAnalytics(measurementId, 'denied');
    const count = target.dataLayer.length;
    analytics.trackPageView(measurementId);
    expect(target.dataLayer).toHaveLength(count);
    expect(target[`ga-disable-${measurementId}`]).toBe(true);
  });

  it('honors rejection when storage writes fail and reads retain an old grant', async () => {
    const analytics = await import('../lib/analytics');
    analytics.saveAnalyticsConsent('granted');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    analytics.saveAnalyticsConsent('denied');
    expect(analytics.readAnalyticsConsent()).toBe('denied');
  });

  it('treats cleared consent as no decision', async () => {
    const analytics = await import('../lib/analytics');
    analytics.saveAnalyticsConsent('granted');
    storage.clear();
    expect(analytics.readAnalyticsConsent()).toBeNull();
  });
});
