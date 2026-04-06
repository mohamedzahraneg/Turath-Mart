'use client';
import React, { useState, useEffect } from 'react';

export default function DashboardHeader() {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = now?.getHours()?.toString()?.padStart(2, '0');
      const m = now?.getMinutes()?.toString()?.padStart(2, '0');
      const s = now?.getSeconds()?.toString()?.padStart(2, '0');
      setCurrentTime(`${h}:${m}:${s}`);
      setCurrentDate(
        now?.toLocaleDateString('ar-EG-u-nu-latn', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">لوحة التحكم</h1>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{currentDate}</p>
          <span className="text-[hsl(var(--muted-foreground))]">—</span>
          <span className="text-sm font-mono font-semibold text-[hsl(var(--foreground))]">
            {currentTime}
          </span>
        </div>
      </div>
    </div>
  );
}
