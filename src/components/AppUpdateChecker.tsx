'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { usePathname } from 'next/navigation';

const VERSION_KEY = 'turath_app_version';
const CHECKED_AT_KEY = 'turath_app_version_checked_at';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

type AppVersionResponse = {
  version?: string | null;
};

function isBrowser() {
  return typeof window !== 'undefined';
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled or quota-limited; the app should still run.
  }
}

async function nudgeServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map((registration) => registration.update()));
  } catch {
    // Best effort only. Update checks must never block the app shell.
  }
}

async function clearRuntimeCaches() {
  if ('caches' in window) {
    try {
      const names = await window.caches.keys();
      const appCacheNames = names.filter((name) => /turath|workbox|next|app|runtime/i.test(name));
      await Promise.allSettled(appCacheNames.map((name) => window.caches.delete(name)));
    } catch {
      // Cache API may be unavailable or restricted in some browsers.
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations.map((registration) => registration.unregister()));
    } catch {
      // Safe to ignore; a normal reload still picks up the fresh HTML.
    }
  }
}

export default function AppUpdateChecker() {
  const pathname = usePathname();
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState(false);
  const checkingRef = useRef(false);
  const lastCheckedRef = useRef(0);

  const shouldSkip = pathname === '/change-password';

  const checkVersion = useCallback(
    async (force = false) => {
      if (!isBrowser() || shouldSkip || checkingRef.current) return;

      const now = Date.now();
      const lastChecked = lastCheckedRef.current
        ? lastCheckedRef.current
        : Number(readStorage(CHECKED_AT_KEY) || 0);

      if (!force && now - lastChecked < CHECK_INTERVAL_MS) return;

      checkingRef.current = true;
      lastCheckedRef.current = now;
      writeStorage(CHECKED_AT_KEY, String(now));

      try {
        await nudgeServiceWorkers();

        const response = await fetch(`/api/app-version?t=${now}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            'Cache-Control': 'no-cache',
          },
        });

        if (!response.ok) return;

        const payload = (await response.json()) as AppVersionResponse;
        const serverVersion = payload.version?.trim();
        if (!serverVersion || serverVersion === 'unknown') return;

        const storedVersion = readStorage(VERSION_KEY);
        if (!storedVersion) {
          writeStorage(VERSION_KEY, serverVersion);
          return;
        }

        if (storedVersion !== serverVersion) {
          setPendingVersion(serverVersion);
        }
      } catch {
        // Offline or transient network failures should not disturb the user.
      } finally {
        checkingRef.current = false;
      }
    },
    [shouldSkip]
  );

  useEffect(() => {
    if (shouldSkip) return;

    checkVersion(true);

    const interval = window.setInterval(() => checkVersion(), CHECK_INTERVAL_MS);
    const onFocus = () => checkVersion(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkVersion(true);
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkVersion, shouldSkip]);

  const applyUpdate = async () => {
    if (!pendingVersion) return;

    setReloadError(false);
    try {
      await clearRuntimeCaches();
      writeStorage(VERSION_KEY, pendingVersion);
      window.location.reload();
    } catch {
      setReloadError(true);
    }
  };

  if (!pendingVersion || shouldSkip) return null;

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl rounded-2xl border border-blue-100 bg-white p-4 text-right shadow-2xl shadow-blue-950/10"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setPendingVersion(null)}
        className="absolute left-3 top-3 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        aria-label="إخفاء رسالة التحديث"
      >
        <X size={16} />
      </button>
      <div className="flex flex-col gap-3 pe-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-black text-gray-900">يوجد تحديث جديد للنظام</h2>
          <p className="mt-1 text-xs font-bold leading-relaxed text-gray-500">
            تم نشر نسخة جديدة. اضغط تحديث الآن للحصول على آخر التغييرات.
          </p>
          {reloadError ? (
            <p className="mt-2 text-xs font-bold text-red-600">
              تعذر تحديث الصفحة تلقائيًا. من فضلك أعد تحميل الصفحة يدويًا.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={applyUpdate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-blue-700"
        >
          <RefreshCw size={14} />
          تحديث الآن
        </button>
      </div>
    </div>
  );
}
