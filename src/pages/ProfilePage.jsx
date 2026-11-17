import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { managedAvatarPath } from '../lib/avatarUrl';
import { formatEmployeeDocument, isCnpjDocument } from '../../supabase/functions/_shared/employee-document.mjs';
import { Spinner, Avatar } from '../components/ui';
import WorkScheduleCard from '../components/WorkScheduleCard';
import PjContracts from '../components/PjContracts';

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');

  useEffect(() => {
    if (profile) {
      setNome(profile.nome || '');
      setCargo(profile.cargo || '');
    }
  }, [profile]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (nome.trim().length < 3 || !cargo.trim()) {
      toast.warning('Informe seu nome completo e seu cargo.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('funcionarios')
        .update({ nome: nome.trim(), cargo: cargo.trim() })
        .eq('id', profile.id)
        .select('id')
        .single();

      if (error) throw error;
      await refreshProfile();
      toast.success('Perfil atualizado com sucesso!');
    } catch (err) {
      toast.error('Erro ao atualizar perfil: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (uploading) return;
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Use uma imagem JPEG, PNG ou WebP.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Imagem muito grande. Máximo 5MB.');
      return;
    }

    const fileExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    const bucket = supabase.storage.from('fotos-funcionarios');
    const fileName = `${profile.id}/foto-${crypto.randomUUID()}.${fileExt}`;
    let uploaded = false;
    setUploading(true);
    try {
      const { error: uploadError } = await bucket.upload(fileName, file, { cacheControl: '300' });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { data: { publicUrl } } = bucket.getPublicUrl(fileName);
      const update = supabase
        .from('funcionarios')
        .update({ foto_url: publicUrl })
        .eq('id', profile.id);
      const { data, error: profileError } = await (profile.foto_url == null
        ? update.is('foto_url', null)
        : update.eq('foto_url', profile.foto_url)).select('id').maybeSingle();
      if (profileError) throw profileError;
      if (!data) throw new Error('O perfil mudou durante o envio. Atualize a página e tente novamente.');
    } catch (err) {
      // The delete policy preserves the currently referenced object even if
      // the profile update succeeded but its response was lost.
      if (uploaded) await bucket.remove([fileName]).catch(() => {});
      toast.error('Não foi possível confirmar a atualização da foto: ' + err.message);
      setUploading(false);
      return;
    }
    try {
      const previous = managedAvatarPath(profile.foto_url, import.meta.env.VITE_SUPABASE_URL, profile.id);
      const legacy = ['jpg', 'jpeg', 'png', 'webp'].map((extension) => `${profile.id}/foto.${extension}`);
      const retired = [...new Set([previous, ...legacy].filter(Boolean))];
      const { data: removed, error } = await bucket.remove(retired);
      if (error) throw error;
      if (previous && !removed?.some(({ name }) => name === previous)) throw new Error('Remoção não confirmada.');
      toast.success('Foto atualizada com sucesso!');
    } catch {
      toast.warning('A foto foi atualizada. A remoção da imagem anterior ficou pendente.');
    } finally {
      await refreshProfile();
      setUploading(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex flex-center" style={{ minHeight: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div className="page-header">
        <h2 className="page-title">Meu Perfil</h2>
      </div>

      {/* Photo */}
      <div className="card mb-6">
        <div className="flex gap-4" style={{ alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Avatar src={profile.foto_url} name={profile.nome} size="xl" />
            <label
              className="profile-photo-upload"
              title="Alterar foto de perfil"
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                background: 'var(--gradient-primary)',
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: uploading ? 'wait' : 'pointer',
                fontSize: 'var(--font-sm)',
              }}
            >
              {uploading ? '⏳' : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>}
              <input
                type="file"
                aria-label="Alterar foto de perfil"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoUpload}
                disabled={uploading}
              />
            </label>
          </div>
          <div>
            <h3 style={{ color: 'var(--text-primary)', fontSize: 'var(--font-xl)', fontWeight: 700 }}>
              {profile.nome}
            </h3>
            <p className="text-muted">{profile.cargo}</p>
          </div>
        </div>
      </div>

      {profile.tipo_contrato !== 'pj' && <WorkScheduleCard schedule={profile.escala_trabalho} admissionDate={profile.data_admissao} preferenceKey={profile.id} />}
      {profile.tipo_contrato === 'pj' && profile.role !== 'admin' && <PjContracts key={profile.id} employeeId={profile.id} />}

      {/* Info Card */}
      <div className="card mb-6">
        <h3 className="card-title mb-4">Informações</h3>
        <div className="table-card-row">
          <span className="table-card-label">{isCnpjDocument(profile.cpf) ? 'CNPJ' : 'CPF'}</span>
          <span className="table-card-value">{formatEmployeeDocument(profile.cpf)}</span>
        </div>
        <div className="table-card-row">
          <span className="table-card-label">E-mail</span>
          <span className="table-card-value">{profile.email}</span>
        </div>
        <div className="table-card-row">
          <span className="table-card-label">Status</span>
          <span className="table-card-value">
            <span className={`profile-value-with-icon ${profile.ativo ? 'is-active' : 'is-inactive'}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>{profile.ativo ? 'Ativo' : 'Inativo'}</span>
          </span>
        </div>
        <div className="table-card-row">
          <span className="table-card-label">Perfil</span>
          <span className="table-card-value">
            <span className="profile-value-with-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{profile.role === 'admin' ? <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></> : <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>}</svg>{profile.role === 'admin' ? 'Administrador' : 'Funcionário'}</span>
          </span>
        </div>
      </div>

      {/* Edit Form */}
      <div className="card">
        <h3 className="card-title mb-4">Editar Perfil</h3>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label" htmlFor="profile-name">Nome completo</label>
            <input
              id="profile-name"
              required
              minLength={3}
              maxLength={160}
              type="text"
              className="form-input"
              value={nome}
              onChange={e => setNome(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="profile-job">Cargo</label>
            <input
              id="profile-job"
              required
              maxLength={120}
              type="text"
              className="form-input"
              value={cargo}
              onChange={e => setCargo(e.target.value)}
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <Spinner /> : 'Salvar alterações'}
          </button>
        </form>
      </div>
    </div>
  );
}
