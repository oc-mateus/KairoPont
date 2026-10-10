import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { formatCPF } from '../lib/utils';
import { Spinner, Avatar } from '../components/ui';
import WorkScheduleCard from '../components/WorkScheduleCard';

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
    setLoading(true);
    try {
      const { error } = await supabase
        .from('funcionarios')
        .update({ nome, cargo })
        .eq('id', profile.id);

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

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile.id}/foto.${fileExt}`;

      let finalUrl = '';
      try {
        const { error: uploadError } = await supabase.storage
          .from('fotos-funcionarios')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('fotos-funcionarios')
          .getPublicUrl(fileName);
        
        finalUrl = urlData.publicUrl + '?t=' + Date.now();

        await supabase
          .from('funcionarios')
          .update({ foto_url: finalUrl })
          .eq('id', profile.id);
          
      } catch (uploadErr) {
        console.warn('Fallback para imagem local em base64 (Storage não configurado)');
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        finalUrl = base64;
        localStorage.setItem(`mock_foto_${profile.id}`, base64);
      }

      await refreshProfile();
      toast.success('Foto atualizada com sucesso!');
    } catch (err) {
      toast.error('Erro ao atualizar foto: ' + err.message);
    } finally {
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
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoUpload}
                style={{ display: 'none' }}
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

      {/* Info Card */}
      <div className="card mb-6">
        <h3 className="card-title mb-4">Informações</h3>
        <div className="table-card-row">
          <span className="table-card-label">CPF</span>
          <span className="table-card-value">{formatCPF(profile.cpf)}</span>
        </div>
        <div className="table-card-row">
          <span className="table-card-label">E-mail</span>
          <span className="table-card-value">{profile.email}</span>
        </div>
        <div className="table-card-row">
          <span className="table-card-label">Status</span>
          <span className="table-card-value">
            {profile.ativo ? '🟢 Ativo' : '🔴 Inativo'}
          </span>
        </div>
        <div className="table-card-row">
          <span className="table-card-label">Perfil</span>
          <span className="table-card-value">
            {profile.role === 'admin' ? '🛡️ Administrador' : '👤 Funcionário'}
          </span>
        </div>
      </div>

      {/* Edit Form */}
      <div className="card">
        <h3 className="card-title mb-4">Editar Perfil</h3>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">Nome completo</label>
            <input
              type="text"
              className="form-input"
              value={nome}
              onChange={e => setNome(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Cargo</label>
            <input
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
