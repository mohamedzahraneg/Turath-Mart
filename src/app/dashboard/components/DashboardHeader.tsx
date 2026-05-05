'use client';
import React, { useState, useEffect, memo } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// LiveClock is a tiny isolated component so that the per-second tick only
// re-renders the clock span — not the whole DashboardHeader (which used to
// re-render its title and date every second too).
// ─────────────────────────────────────────────────────────────────────────────
const LiveClock = memo(function LiveClock() {
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      setCurrentTime(`${h}:${m}:${s}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-sm font-mono font-semibold text-[hsl(var(--foreground))]">
      {currentTime}
    </span>
  );
});

export default function DashboardHeader() {
  // Date is computed once on mount and updated only when the page is hidden
  // and re-shown (so it ticks over to the next day cleanly). It does NOT
  // tick every second.
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const computeDate = () => {
      setCurrentDate(
        new Date().toLocaleDateString('ar-EG-u-nu-latn', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    };
    computeDate();

    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) computeDate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">لوحة التحكم</h1>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{currentDate}</p>
          <span className="text-[hsl(var(--muted-foreground))]">—</span>
          <LiveClock />
        </div>
      </div>
    </div>
  );
}
