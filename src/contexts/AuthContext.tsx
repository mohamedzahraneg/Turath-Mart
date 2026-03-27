'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

// Role definitions (used only as fallback type)
export type UserRole = 'manager' | 'data_entry' | 'shipping' | 'supervisor' | string;

// Permission → route mapping: which permissions unlock which routes
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

// Fallback route map for legacy role strings (if no roleId stored)
export const ROLE_ALLOWED_ROUTES: Record<string, string[]> = {
  manager: ['/dashboard', '/orders-management', '/shipping', '/inventory', '/reports', '/users', '/roles', '/settings', '/track', '/crm'],
  data_entry: ['/orders-management', '/shipping', '/track'],
  shipping: ['/shipping', '/track'],
  supervisor: ['/dashboard', '/orders-management', '/shipping', '/track', '/reports'],
};

// Default redirect after login per role
export const ROLE_DEFAULT_ROUTE: Record<string, string> = {
  manager: '/dashboard',
  data_entry: '/orders-management',
  shipping: '/shipping',
  supervisor: '/shipping',
};

// Load roles from localStorage
function loadStoredRoles(): Array<{ id: string; permissions: string[] }> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('turath_roles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Get allowed routes for a roleId based on its permissions
function getAllowedRoutesForRoleId(roleId: string): string[] | null {
  const roles = loadStoredRoles();
  const role = roles.find(r => r.id === roleId);
  if (!role) return null;

  const routes = new Set<string>(['/track']); // track always allowed
  for (const perm of role.permissions) {
    const permRoutes = PERMISSION_ROUTE_MAP[perm] || [];
    permRoutes.forEach(r => routes.add(r));
  }
  return Array.from(routes);
}

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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('current_user');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.role) {
            setCurrentRole(parsed.role as string);
            setCurrentRoleId(parsed.roleId || null);
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
    }

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

      return () => subscription.unsubscribe();
    } catch {
      setLoading(false);
    }
  }, []);

  // Check if current role can access a given path
  const hasAccess = (path: string): boolean => {
    if (roleLoading) return true;
    if (currentRole === null) return false;

    // Manager always has full access
    if (currentRole === 'manager') return true;

    // Try permission-based access using roleId
    if (currentRoleId) {
      const allowedRoutes = getAllowedRoutesForRoleId(currentRoleId);
      if (allowedRoutes) {
        return allowedRoutes.some(route =>
          path === route || path.startsWith(route + '/') || path.startsWith(route + '?')
        );
      }
    }

    // Fallback: use legacy role string map
    const allowed = ROLE_ALLOWED_ROUTES[currentRole] ?? [];
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
    getUserProfile
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
