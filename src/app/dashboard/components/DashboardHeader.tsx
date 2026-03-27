'use client';
import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, Calendar } from 'lucide-react';

export default function DashboardHeader() {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTime(now?.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
      setCurrentDate(now?.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">لوحة التحكم</h1>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {currentDate} — آخر تحديث: {currentTime}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-secondary text-sm">
          <Calendar size={16} />
          <span>اليوم</span>
        </button>
        <button className="btn-secondary text-sm">
          <Download size={16} />
          <span>تصدير</span>
        </button>
        <button className="btn-primary text-sm">
          <RefreshCw size={16} />
          <span>تحديث</span>
        </button>
      </div>
    </div>
  );
}