import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { punchAccountKey, readOfflinePunchProfile, rememberOfflinePunchProfile, subscribeToPunchQueue, syncPunchQueue } from '../lib/offlinePunches';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [cachedPunchProfile, setCachedPunchProfile] = useState(readOfflinePunchProfile);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const profileRequestId = useRef(0);
  const wasOffline = useRef(!navigator.onLine);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryPending(true);
        if (event === 'SIGNED_OUT') setPasswordRecoveryPending(false);
      if (event === 'SIGNED_OUT' && navigator.onLine) saveOfflineProfile(null);
        setSession(session);
        if (session?.user) {
        setProfile((current) => current?.auth_id === session.user.id ? current : null);
        if (!navigator.onLine) {
          profileRequestId.current += 1;
          setLoading(false);
          return;
        }
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

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    const updateCachedProfile = () => setCachedPunchProfile(readOfflinePunchProfile());
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    window.addEventListener('storage', updateCachedProfile);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
      window.removeEventListener('storage', updateCachedProfile);
    };
  }, []);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    let cancelled = false;
    const restore = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      setSession(data.session);
      await fetchProfile(data.session.user.id);
    };
    void restore().catch(() => {});
    return () => { cancelled = true; };
  // The auth subscription loads the initial profile and handles account changes.
  // This effect retries on the transition back to an online connection.
  }, [online]);

  useEffect(() => {
    if (!online || !session || !profile?.ativo || session.user.id !== profile.auth_id) return;
    const sync = () => { void syncPunchQueue(supabase, profile).catch(() => {}); };
    const unsubscribe = subscribeToPunchQueue(punchAccountKey(profile), sync);
    const timer = setInterval(sync, 6000);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [online, session?.user.id, profile]);

  function saveOfflineProfile(value) {
    rememberOfflinePunchProfile(value);
    setCachedPunchProfile(readOfflinePunchProfile());
  }

  async function fetchProfile(userId, requestId = ++profileRequestId.current) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const { data, error } = await supabase
        .from('funcionarios')
        .select('id,auth_id,nome,cpf,email,cargo,ativo,role,suporte,foto_url,tipo_contrato,data_admissao,escala_trabalho')
        .eq('auth_id', userId)
        .single()
        .abortSignal(controller.signal);

      if (error && error.code !== 'PGRST116') {
        console.error('Erro ao buscar perfil:', error);
      }
      
      if (requestId === profileRequestId.current) {
        const unavailable = Boolean(error && !error.code);
        setProfileUnavailable(unavailable);
        if (!unavailable) {
          setProfile(data || null);
          saveOfflineProfile(data);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar perfil:', err);
      if (requestId === profileRequestId.current) setProfileUnavailable(true);
    } finally {
      window.clearTimeout(timeout);
      if (requestId === profileRequestId.current) setLoading(false);
    }
  }

  async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    saveOfflineProfile(null);
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
      setLoading(true);
      await fetchProfile(session.user.id);
    }
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    online,
    offlinePunchProfile: (!online || (profileUnavailable && session))
      && (!session || session.user.id === cachedPunchProfile?.auth_id)
      ? cachedPunchProfile : null,
    isAdmin: profile?.role === 'admin',
    isSupport: profile?.ativo === true && profile?.suporte === true,
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
