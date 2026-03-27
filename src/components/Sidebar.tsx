'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth, ROLE_ALLOWED_ROUTES } from '@/contexts/AuthContext';
import { LayoutDashboard, Package, Truck, BarChart3, Warehouse, Settings, ChevronRight, ChevronLeft, Bell, LogOut, ShieldCheck,  } from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
  group?: string;
}

const navItems: NavItem[] = [
  { id: 'nav-dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard size={20} />, href: '/dashboard', group: 'رئيسي' },
  { id: 'nav-orders', label: 'الأوردرات', icon: <Package size={20} />, href: '/orders-management', badge: 7, group: 'رئيسي' },
  { id: 'nav-shipping', label: 'الشحن', icon: <Truck size={20} />, href: '/shipping', group: 'رئيسي' },
  { id: 'nav-inventory', label: 'المخزون', icon: <Warehouse size={20} />, href: '/inventory', group: 'إدارة' },
  { id: 'nav-reports', label: 'التقارير', icon: <BarChart3 size={20} />, href: '/reports', group: 'إدارة' },
  { id: 'nav-roles', label: 'المستخدمون والصلاحيات', icon: <ShieldCheck size={20} />, href: '/roles', group: 'النظام' },
  { id: 'nav-settings', label: 'الإعدادات', icon: <Settings size={20} />, href: '/settings', group: 'النظام' },
];

const groups = ['رئيسي', 'إدارة', 'النظام'];

const ROLE_LABELS: Record<string, string> = {
  manager: 'مدير النظام',
  data_entry: 'موظف إدخال بيانات',
  shipping: 'مندوب شحن',
  supervisor: 'مشرف',
};

interface SidebarProps {
  currentPath?: string;
}

export default function Sidebar({ currentPath = '' }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userName, setUserName] = useState('المستخدم');
  const { currentRole } = useAuth();

  const allowedRoutes = ROLE_ALLOWED_ROUTES[currentRole] ?? [];

  // Filter nav items to only those the current role can access
  const visibleNavItems = navItems.filter((item) =>
    allowedRoutes.some((route) => item.href === route || item.href.startsWith(route + '/'))
  );

  const isActive = (href: string) => currentPath === href || currentPath.startsWith(href);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('current_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        const name = parsed?.name || parsed?.email?.split('@')[0] || 'المستخدم';
        setUserName(name);
      }
    } catch {}
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('current_user');
    window.location.href = '/sign-up-login-screen';
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile toggle */}
      <button
        className="fixed top-4 right-4 z-50 lg:hidden bg-white border border-[hsl(var(--border))] rounded-xl p-2 shadow-md"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="فتح القائمة"
      >
        <ChevronLeft size={20} className="text-[hsl(var(--foreground))]" />
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative top-0 right-0 h-full z-50 lg:z-auto
          flex flex-col bg-white border-l border-[hsl(var(--border))] shadow-lg lg:shadow-none
          transition-all duration-300 ease-in-out
          ${collapsed ? 'w-[72px]' : 'w-[260px]'}
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className={`flex items-center border-b border-[hsl(var(--border))] ${collapsed ? 'p-4 justify-center' : 'p-4 gap-3'}`}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <AppLogo size={36} />
            {!collapsed && (
              <div>
                <span className="font-display text-lg font-bold text-[hsl(var(--primary))] block leading-tight">
                  تراث مارت
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Turath Mart</span>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle — desktop only */}
        <button
          className="hidden lg:flex absolute -left-3 top-16 bg-white border border-[hsl(var(--border))] rounded-full w-6 h-6 items-center justify-center shadow-sm hover:shadow-md transition-shadow z-10"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
        >
          {collapsed ? (
            <ChevronLeft size={12} className="text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight size={12} className="text-[hsl(var(--muted-foreground))]" />
          )}
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 scrollbar-thin">
          {groups.map((group) => {
            const items = visibleNavItems.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={`group-${group}`} className="mb-4">
                {!collapsed && (
                  <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest px-3 mb-2">
                    {group}
                  </p>
                )}
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className={`sidebar-item ${isActive(item.href) ? 'sidebar-item-active' : 'sidebar-item-inactive'} ${collapsed ? 'justify-center px-2' : ''}`}
                        title={collapsed ? item.label : undefined}
                        onClick={() => setMobileOpen(false)}
                      >
                        <span className="flex-shrink-0">{item.icon}</span>
                        {!collapsed && (
                          <>
                            <span className="flex-1 text-sm">{item.label}</span>
                            {item.badge && (
                              <span className="bg-[hsl(var(--accent))] text-white text-xs rounded-full px-2 py-0.5 font-bold min-w-[20px] text-center">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                        {collapsed && item.badge && (
                          <span className="absolute top-1 left-1 bg-[hsl(var(--accent))] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Bottom: user + notifications */}
        <div className="border-t border-[hsl(var(--border))] p-3 space-y-1">
          <button className={`sidebar-item sidebar-item-inactive w-full ${collapsed ? 'justify-center' : ''}`}>
            <Bell size={18} />
            {!collapsed && <span className="text-sm">الإشعارات</span>}
            {!collapsed && (
              <span className="mr-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 font-bold">3</span>
            )}
          </button>

          {!collapsed && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))] mt-2">
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {userName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{userName}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{ROLE_LABELS[currentRole] ?? currentRole}</p>
              </div>
              <button onClick={handleLogout} className="text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors" aria-label="تسجيل الخروج">
                <LogOut size={16} />
              </button>
            </div>
          )}

          {collapsed && (
            <button onClick={handleLogout} className="sidebar-item sidebar-item-inactive w-full justify-center" title="تسجيل الخروج">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}