'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

export type UserRole = 'manager' | 'data_entry' | 'shipping' | 'supervisor' | string;

// Permission → route mapping
const PERMISSION_ROUTE_MAP: Record<string, string[]> = {
  view_dashboard: ['/dashboard'],
  view_orders: ['/orders-management'],
  create_orders: ['/orders-management'],
  edit_orders: ['/orders-management'],
  delete_orders: ['/orders-management'],
  update_status: ['/orders-management'],
  view_shipping: ['/shipping'],
  manage_shipping: ['/shipping'],
  assign_courier: ['/shipping'],
  view_inventory: ['/inventory'],
  edit_inventory: ['/inventory'],
  view_reports: ['/reports'],
  export_reports: ['/reports'],
  manage_users: ['/users', '/roles'],
  manage_roles: ['/roles'],
  view_customers: ['/crm'],
  manage_customers: ['/crm'],
  customer_support: ['/crm'],
  system_settings: ['/settings'],
};

// All permissions list (full access)
const ALL_PERMISSIONS = Object.keys(PERMISSION_ROUTE_MAP);

// Default roles — always available as fallback when localStorage is empty
const DEFAULT_ROLES: Array<{ id: string; name: string; permissions: string[] }> = [
  { id: 'r1', name: 'مدير النظام', permissions: ALL_PERMISSIONS },
  { id: 'r2', name: 'مشرف النظام', permissions: ['view_dashboard', 'view_orders', 'edit_orders', 'update_status', 'view_shipping', 'manage_shipping', 'view_inventory', 'view_reports', 'export_reports', 'manage_users'] },
  { id: 'r3', name: 'مشرف شحن', permissions: ['view_dashboard', 'view_orders', 'create_orders', 'edit_orders', 'update_status', 'view_shipping', 'manage_shipping', 'assign_courier', 'view_inventory', 'view_reports'] },
  { id: 'r4', name: 'مندوب شحن', permissions: ['view_orders', 'update_status', 'view_shipping'] },
  { id: 'r5', name: 'مدير خدمة عملاء', permissions: ['view_dashboard', 'view_orders', 'view_shipping', 'view_reports', 'export_reports', 'view_customers', 'manage_customers', 'customer_support'] },
  { id: 'r6', name: 'خدمة عملاء', permissions: ['view_orders', 'view_shipping', 'view_customers', 'customer_support'] },
];

// Default redirect per first available permission
const PERMISSION_DEFAULT_ROUTE_PRIORITY = [
  'view_dashboard',
  'view_orders',
  'view_shipping',
  'view_reports',
  'view_inventory',
  'view_customers',
  'manage_users',
  'system_settings',
];

export function getDefaultRouteForPermissions(permissions: string[]): string {
  for (const perm of PERMISSION_DEFAULT_ROUTE_PRIORITY) {
    if (permissions.includes(perm)) {
      return PERMISSION_ROUTE_MAP[perm]?.[0] ?? '/shipping';
    }
  }
  return '/shipping';
}

// Load roles from localStorage, merge with defaults
function loadRoles(): Array<{ id: string; name: string; permissions: string[] }> {
  if (typeof window === 'undefined') return DEFAULT_ROLES;
  try {
    const raw = localStorage.getItem('turath_roles');
    if (!raw) return DEFAULT_ROLES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ROLES;
    // Merge: stored roles take priority, add defaults not in stored
    const storedIds = new Set(parsed.map((r: any) => r.id));
    const merged = [...parsed, ...DEFAULT_ROLES.filter(r => !storedIds.has(r.id))];
    return merged;
  } catch {
    return DEFAULT_ROLES;
  }
}

// Get permissions for a roleId
export function getPermissionsForRoleId(roleId: string): string[] {
  const roles = loadRoles();
  const role = roles.find(r => r.id === roleId);
  return role?.permissions ?? [];
}

// Get allowed routes for a roleId
function getAllowedRoutesForRoleId(roleId: string): string[] {
  const permissions = getPermissionsForRoleId(roleId);
  const routes = new Set<string>(['/track']); // track always allowed
  for (const perm of permissions) {
    const permRoutes = PERMISSION_ROUTE_MAP[perm] ?? [];
    permRoutes.forEach(r => routes.add(r));
  }
  return Array.from(routes);
}

// Check if a roleId has full/manager-level access
function isManagerRole(roleId: string): boolean {
  if (roleId === 'r1') return true;
  const permissions = getPermissionsForRoleId(roleId);
  // Has system_settings = admin-level
  return permissions.includes('system_settings') && permissions.includes('manage_roles');
}

// Legacy export for AppLayout redirect
export const ROLE_DEFAULT_ROUTE: Record<string, string> = {
  manager: '/dashboard',
  data_entry: '/orders-management',
  shipping: '/shipping',
  supervisor: '/dashboard',
};

const AuthContext = createContext<any>({
  hasAccess: () => true,
  currentRole: null,
  currentRoleId: null,
  loading: true,
  roleLoading: true,
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentRoleId, setCurrentRoleId] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const loadCurrentUser = () => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('current_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.roleId) {
          setCurrentRoleId(parsed.roleId);
          const roleType = isManagerRole(parsed.roleId) ? 'manager' : (parsed.role || 'data_entry');
          setCurrentRole(roleType);
        } else if (parsed?.role) {
          setCurrentRole(parsed.role);
          setCurrentRoleId(null);
        } else {
          setCurrentRole(null);
          setCurrentRoleId(null);
        }
      } else {
        setCurrentRole(null);
        setCurrentRoleId(null);
      }
    } catch {
      setCurrentRole(null);
      setCurrentRoleId(null);
    }
    setRoleLoading(false);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      loadCurrentUser();

      // Listen for role changes (when roles are updated in the roles page)
      const handleRolesUpdated = () => {
        loadCurrentUser();
      };
      window.addEventListener('turath_roles_updated', handleRolesUpdated);
      window.addEventListener('storage', handleRolesUpdated);

      try {
        const supabase = createClient();
        if (!supabase) { setLoading(false); return; }

        supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }).catch(() => { setLoading(false); });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        });

        return () => {
          subscription.unsubscribe();
          window.removeEventListener('turath_roles_updated', handleRolesUpdated);
          window.removeEventListener('storage', handleRolesUpdated);
        };
      } catch {
        setLoading(false);
        return () => {
          window.removeEventListener('turath_roles_updated', handleRolesUpdated);
          window.removeEventListener('storage', handleRolesUpdated);
        };
      }
    }
  }, []);

  // Check if current user can access a given path
  const hasAccess = (path: string): boolean => {
    if (roleLoading) return true;
    if (currentRole === null && currentRoleId === null) return false;

    // Manager (r1 or system_settings+manage_roles) has FULL access
    if (currentRole === 'manager') return true;
    if (currentRoleId && isManagerRole(currentRoleId)) return true;

    // Permission-based access using roleId
    if (currentRoleId) {
      const allowedRoutes = getAllowedRoutesForRoleId(currentRoleId);
      return allowedRoutes.some(route =>
        path === route || path.startsWith(route + '/') || path.startsWith(route + '?')
      );
    }

    // Fallback: if only legacy role string, allow basic access
    const legacyMap: Record<string, string[]> = {
      manager: ['/dashboard', '/orders-management', '/shipping', '/inventory', '/reports', '/users', '/roles', '/settings', '/track', '/crm'],
      supervisor: ['/dashboard', '/orders-management', '/shipping', '/track', '/reports'],
      data_entry: ['/orders-management', '/shipping', '/track'],
      shipping: ['/shipping', '/track'],
    };
    const allowed = legacyMap[currentRole ?? ''] ?? [];
    return allowed.some(route =>
      path === route || path.startsWith(route + '/') || path.startsWith(route + '?')
    );
  };

  const signUp = async (email: string, password: string, metadata = {}) => {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase not available');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: (metadata as any)?.fullName || '',
          avatar_url: (metadata as any)?.avatarUrl || ''
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email: string, password: string) => {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase not available');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('current_user');
    }
    setCurrentRole(null);
    setCurrentRoleId(null);
    try {
      const supabase = createClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {}
  };

  const getCurrentUser = async () => {
    try {
      const supabase = createClient();
      if (!supabase) return null;
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      return user;
    } catch {
      return null;
    }
  };

  const isEmailVerified = () => user?.email_confirmed_at !== null;

  const getUserProfile = async () => {
    if (!user) return null;
    try {
      const supabase = createClient();
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    } catch {
      return null;
    }
  };

  const value = {
    user,
    session,
    loading,
    roleLoading,
    currentRole,
    currentRoleId,
    setCurrentRole,
    setCurrentRoleId,
    hasAccess,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    isEmailVerified,
    getUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
