import React from 'react';
import Sidebar from './Sidebar';

interface AppLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

export default function AppLayout({ children, currentPath = '' }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-[hsl(210,20%,97%)]" dir="rtl">
      <Sidebar currentPath={currentPath} />
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-screen-2xl mx-auto px-4 lg:px-6 xl:px-8 2xl:px-10 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}