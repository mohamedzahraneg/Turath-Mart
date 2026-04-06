'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Package,
  Truck,
  BarChart3,
  Warehouse,
  Settings,
  ChevronRight,
  ChevronLeft,
  Bell,
  LogOut,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import NotificationDropdown from '@/components/NotificationDropdown';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
  group?: string;
}

const navItems: NavItem[] = [
  {
    id: 'nav-dashboard',
    label: 'لوحة التحكم',
    icon: <LayoutDashboard size={20} />,
    href: '/dashboard',
    group: 'رئيسي',
  },
  {
    id: 'nav-orders',
    label: 'الأوردرات',
    icon: <Package size={20} />,
    href: '/orders-management',
    group: 'رئيسي',
  },
  {
    id: 'nav-shipping',
    label: 'الشحن',
    icon: <Truck size={20} />,
    href: '/shipping',
    group: 'رئيسي',
  },
  {
    id: 'nav-crm',
    label: 'إدارة العملاء (CRM)',
    icon: <Users size={20} />,
    href: '/crm',
    group: 'إدارة',
  },
  {
    id: 'nav-inventory',
    label: 'المخزون',
    icon: <Warehouse size={20} />,
    href: '/inventory',
    group: 'إدارة',
  },
  {
    id: 'nav-reports',
    label: 'التقارير',
    icon: <BarChart3 size={20} />,
    href: '/reports',
    group: 'إدارة',
  },
  {
    id: 'nav-roles',
    label: 'المستخدمون والصلاحيات',
    icon: <ShieldCheck size={20} />,
    href: '/roles',
    group: 'النظام',
  },
  {
    id: 'nav-settings',
    label: 'الإعدادات',
    icon: <Settings size={20} />,
    href: '/settings',
    group: 'النظام',
  },
];

const groups = ['رئيسي', 'إدارة', 'النظام'];

const ROLE_LABELS: Record<string, string> = {
  r1: 'مدير النظام',
  r2: 'مشرف النظام',
  r3: 'مشرف شحن',
  r4: 'مندوب شحن',
  r5: 'مدير خدمة عملاء',
  r6: 'خدمة عملاء',
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
  const [userRoleLabel, setUserRoleLabel] = useState('موظف');
  const [showNotifications, setShowNotifications] = useState(false);
  const { currentRole, currentRoleId, hasAccess, signOut } = useAuth();
  const { newOrdersCount, unreadCount } = useNotifications();

  // Only True Admin (r1) sees EVERYTHING without filtering
  const isSuperAdmin = currentRoleId === 'r1';
  const visibleNavItems = isSuperAdmin ? navItems : navItems.filter((item) => hasAccess(item.href));

  const isActive = (href: string) => currentPath === href || currentPath.startsWith(href);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('current_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        const name = parsed?.name || parsed?.email?.split('@')[0] || 'المستخدم';
        setUserName(name);
        
        // Determine role label
        const roleId = parsed?.roleId;
        const roleName = parsed?.role;
        
        if (roleId && ROLE_LABELS[roleId]) {
          setUserRoleLabel(ROLE_LABELS[roleId]);
        } else if (roleName && ROLE_LABELS[roleName]) {
          setUserRoleLabel(ROLE_LABELS[roleName]);
        } else {
          setUserRoleLabel(roleName || 'موظف');
        }
      }
    } catch {}
  }, [currentRole, currentRoleId]);

  const handleLogout = async () => {
    try {
      // Use AuthContext signOut which clears ALL session data properly
      await signOut();
    } catch (e) {
      // Fallback: clear manually if signOut fails
      try { localStorage.removeItem('current_user'); } catch {}
    } finally {
      // Always redirect to login
      window.location.href = '/sign-up-login-screen';
    }
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

      <aside
        className={`fixed inset-y-0 right-0 z-50 lg:static bg-white border-l border-[hsl(var(--border))] flex flex-col transition-all duration-300 ease-in-out shadow-xl lg:shadow-none
          ${collapsed ? 'w-20' : 'w-72'}
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="p-6 flex items-center justify-between">
          {!collapsed && <AppLogo />}
          {collapsed && (
            <div className="mx-auto">
              <div className="w-10 h-10 bg-[hsl(var(--primary))] rounded-xl flex items-center justify-center text-white font-bold text-xl">
                T
              </div>
            </div>
          )}
        </div>

        {/* Collapse toggle (desktop) */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex absolute -left-3 top-24 w-6 h-6 bg-white border border-[hsl(var(--border))] rounded-full items-center justify-center shadow-sm hover:bg-[hsl(var(--muted))] transition-colors z-10"
          title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
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
                  {items.map((item) => {
                    const badge = item.id === 'nav-orders' ? newOrdersCount : item.badge;
                    return (
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
                              {(badge || 0) > 0 && (
                                <span className="bg-[hsl(var(--accent))] text-white text-xs rounded-full px-2 py-0.5 font-bold min-w-[20px] text-center">
                                  {badge}
                                </span>
                              )}
                            </>
                          )}
                          {collapsed && (badge || 0) > 0 && (
                            <span className="absolute top-1 left-1 bg-[hsl(var(--accent))] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                              {badge}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Bottom: user + notifications */}
        <div className="border-t border-[hsl(var(--border))] p-3 space-y-1 relative">
          {showNotifications && (
            <NotificationDropdown onClose={() => setShowNotifications(false)} />
          )}
          <button
            className={`sidebar-item w-full ${showNotifications ? 'sidebar-item-active' : 'sidebar-item-inactive'} ${collapsed ? 'justify-center' : ''}`}
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <Bell size={18} />
            {!collapsed && <span className="text-sm">الإشعارات</span>}
            {unreadCount > 0 && (
              <span
                className={`bg-red-500 text-white text-xs rounded-full font-bold flex items-center justify-center ${collapsed ? 'absolute top-1 left-1 w-4 h-4 text-[10px]' : 'mr-auto px-1.5 py-0.5'}`}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {!collapsed && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))] mt-2">
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {userName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{userName}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                  {userRoleLabel}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors"
                aria-label="تسجيل الخروج"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}

          {collapsed && (
            <button
              onClick={handleLogout}
              className="sidebar-item sidebar-item-inactive w-full justify-center"
              title="تسجيل الخروج"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
