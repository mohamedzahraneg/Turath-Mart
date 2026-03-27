'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

// Role definitions
export type UserRole = 'manager' | 'data_entry' | 'shipping' | 'supervisor';

// Routes each role is allowed to access (prefix match)
export const ROLE_ALLOWED_ROUTES: Record<UserRole, string[]> = {
  manager: ['/dashboard', '/orders-management', '/shipping', '/inventory', '/reports', '/users', '/roles', '/settings', '/track'],
  data_entry: ['/shipping', '/track'],
  shipping: ['/shipping', '/track'],
  supervisor: ['/shipping', '/track'],
};

// Default redirect after login per role
export const ROLE_DEFAULT_ROUTE: Record<UserRole, string> = {
  manager: '/dashboard',
  data_entry: '/shipping',
  shipping: '/shipping',
  supervisor: '/shipping',
};

const AuthContext = createContext<any>({
  hasAccess: () => true,
  currentRole: 'manager' as UserRole,
  loading: false,
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
  const [currentRole, setCurrentRole] = useState<UserRole>('manager');

  useEffect(() => {
    // Load role from localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('current_user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.role) setCurrentRole(parsed.role as UserRole);
        } catch {}
      }
    }

    // Try to initialize Supabase session (non-blocking)
    try {
      const supabase = createClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });

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
    const allowed = ROLE_ALLOWED_ROUTES[currentRole] ?? [];
    return allowed.some((route) => path === route || path.startsWith(route + '/') || path.startsWith(route + '?'));
  };

  // Email/Password Sign Up
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

  // Email/Password Sign In
  const signIn = async (email: string, password: string) => {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase not available');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  // Sign Out
  const signOut = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('current_user');
    }
    try {
      const supabase = createClient();
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } catch {}
  };

  // Get Current User
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

  // Check if Email is Verified
  const isEmailVerified = () => {
    return user?.email_confirmed_at !== null;
  };

  // Get User Profile from Database
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
    currentRole,
    setCurrentRole,
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
