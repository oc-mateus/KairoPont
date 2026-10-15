import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const profileRequestId = useRef(0);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryPending(true);
        if (event === 'SIGNED_OUT') setPasswordRecoveryPending(false);
        setSession(session);
        if (session?.user) {
          setLoading(true);
          const requestId = ++profileRequestId.current;
          // Do not make Supabase calls inside onAuthStateChange; auth-js holds an
          // internal lock while notifying listeners.
          window.setTimeout(() => fetchProfile(session.user.id, requestId), 0);
        } else {
          profileRequestId.current += 1;
          setProfile(null);
          setLoading(false);
        }
      });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId, requestId = ++profileRequestId.current) {
    try {
      const { data, error } = await supabase
        .from('funcionarios')
        .select('*')
        .eq('auth_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Erro ao buscar perfil:', error);
      }
      
      if (requestId === profileRequestId.current) setProfile(data || null);
    } catch (err) {
      console.error('Erro ao buscar perfil:', err);
      if (requestId === profileRequestId.current) setProfile(null);
    } finally {
      if (requestId === profileRequestId.current) setLoading(false);
    }
  }

  async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setProfile(null);
    setPasswordRecoveryPending(false);
  }

  function clearPasswordRecovery() {
    setPasswordRecoveryPending(false);
  }

  async function refreshProfile() {
    if (session?.user) {
      await fetchProfile(session.user.id);
    }
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    isActive: profile?.ativo === true,
    passwordRecoveryPending,
    clearPasswordRecovery,
    signInWithEmail,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}
