// Phase 22G — auto-logout when the user is idle.
//
// The hook arms a single setTimeout in `enabled` mode and rearms it
// on user-input events (mousedown, mousemove, keydown, touchstart,
// scroll, click). When the timer elapses it calls `onIdle` exactly
// once per "armed" cycle — `firedRef` blocks the rare double-fire
// path where React re-runs the effect while signOut is still in
// flight.
//
// Disarmed when `enabled` is false (logged-out user, login page).
// Listeners + timer are cleaned up on unmount and on `enabled` flip
// so the timer never leaks into a no-session state.
//
// Intentionally DOES NOT reset on visibilitychange: a hidden tab is
// "away" and should still trigger logout. The timer continues
// ticking under browser background-tab clamping; firing time may
// drift by a few seconds but that is acceptable for this use case.

'use client';
import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'scroll',
  'click',
] as const;

export interface IdleLogoutOptions {
  /** Whether the timer is armed. Set to false on the login page or when logged out. */
  enabled: boolean;
  /** Idle threshold in milliseconds before `onIdle` fires. */
  timeoutMs: number;
  /** Called once when the timer elapses. Will not fire again until `enabled` flips. */
  onIdle: () => void;
}

export function useIdleLogout({ enabled, timeoutMs, onIdle }: IdleLogoutOptions): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  // Latest `onIdle` is held in a ref so the effect doesn't reattach
  // when the caller passes an inline arrow.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) {
      firedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const reset = () => {
      if (firedRef.current) return; // Already fired — do not rearm in this cycle.
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        firedRef.current = true;
        onIdleRef.current();
      }, timeoutMs);
    };

    // Arm immediately.
    reset();

    ACTIVITY_EVENTS.forEach((evt) => {
      window.addEventListener(evt, reset, { passive: true });
    });

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      ACTIVITY_EVENTS.forEach((evt) => {
        window.removeEventListener(evt, reset);
      });
    };
  }, [enabled, timeoutMs]);
}
