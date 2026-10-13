import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import { ConfirmDialog, Spinner } from '../../components/ui';

const EMPTY_FORM = { data: '', nome: '', abrangencia: 'empresa' };

export default function AdminCalendar() {
  const toast = useToast();
  const [holidays, setHolidays] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [holidayToDelete, setHolidayToDelete] = useState(null);
  const [editingHoliday, setEditingHoliday] = useState(null);

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('feriados').select('*').order('data');
      if (error) throw error;
      setHolidays(data || []);
    } catch (error) {
      toast.error('Não foi possível carregar o calendário: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchHolidays(); }, []);

  const saveHoliday = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const query = editingHoliday
        ? supabase.from('feriados').update(form).eq('id', editingHoliday.id)
        : supabase.from('feriados').insert(form);
      const { error } = await query;
      if (error) throw error;
      toast.success(editingHoliday ? 'Data atualizada no calendário.' : 'Data adicionada ao calendário. Ela não contará como falta.');
      setForm(EMPTY_FORM);
      setEditingHoliday(null);
      await fetchHolidays();
    } catch (error) {
      toast.error(error.code === '23505' ? 'Já existe uma data cadastrada nesse dia.' : 'Não foi possível salvar a data: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (holiday) => {
    setEditingHoliday(holiday);
    setForm({ data: holiday.data, nome: holiday.nome, abrangencia: holiday.abrangencia });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditing = () => {
    setEditingHoliday(null);
    setForm(EMPTY_FORM);
  };

  const deleteHoliday = async () => {
    if (!holidayToDelete || deleting) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('feriados').delete().eq('id', holidayToDelete.id);
      if (error) throw error;
      setHolidays((current) => current.filter((item) => item.id !== holidayToDelete.id));
      if (editingHoliday?.id === holidayToDelete.id) cancelEditing();
      toast.success('Data removida do calendário.');
    } catch (error) {
      toast.error('Não foi possível remover a data: ' + error.message);
    } finally {
      setDeleting(false);
      setHolidayToDelete(null);
    }
  };

  return (
    <div className="admin-calendar-page">
      <div className="page-header">
        <h2 className="page-title">Calendário de feriados</h2>
        <p className="page-subtitle">Cadastre feriados nacionais, estaduais, municipais ou da empresa. Nessas datas, não há falta; o trabalho registrado entra como hora extra.</p>
      </div>

      <section className="employee-records-section calendar-form-card">
        <h3>Adicionar data</h3>
        <form className="vacation-form" onSubmit={saveHoliday}>
          <div className="form-row">
            <label className="form-group">Data<input className="form-input" required type="date" value={form.data} onChange={(event) => setForm((current) => ({ ...current, data: event.target.value }))} /></label>
            <label className="form-group">Nome<input className="form-input" required maxLength={120} value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} placeholder="Ex.: Nossa Senhora Aparecida" /></label>
            <label className="form-group">Abrangência<select className="form-input" value={form.abrangencia} onChange={(event) => setForm((current) => ({ ...current, abrangencia: event.target.value }))}><option value="nacional">Nacional</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option><option value="empresa">Empresa</option></select></label>
          </div>
          <div className="employee-punch-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando…' : editingHoliday ? 'Salvar alterações' : 'Adicionar ao calendário'}</button>{editingHoliday && <button type="button" className="btn btn-secondary" disabled={saving} onClick={cancelEditing}>Cancelar edição</button>}</div>
        </form>
      </section>

      <section className="employee-records-section">
        <div className="employee-section-heading"><div><h3>Datas cadastradas</h3><p>{holidays.length} data{holidays.length === 1 ? '' : 's'}</p></div></div>
        {loading ? <div className="flex flex-center" style={{ minHeight: '20vh' }}><Spinner size="lg" /></div>
          : holidays.length ? <div className="table-container"><table className="table"><thead><tr><th>Data</th><th>Feriado</th><th>Abrangência</th><th>Ação</th></tr></thead><tbody>{holidays.map((holiday) => <tr key={holiday.id}><td>{formatDate(`${holiday.data}T12:00:00`)}</td><td>{holiday.nome}</td><td>{({ nacional: 'Nacional', estadual: 'Estadual', municipal: 'Municipal', empresa: 'Empresa' })[holiday.abrangencia] || 'Empresa'}</td><td><div className="employee-punch-actions"><button className="btn btn-secondary btn-sm" disabled={deleting} onClick={() => startEditing(holiday)}>Editar</button><button className="btn btn-danger btn-sm" disabled={deleting} onClick={() => setHolidayToDelete(holiday)}>Remover</button></div></td></tr>)}</tbody></table></div>
            : <p className="employee-no-results">Nenhum feriado cadastrado.</p>}
      </section>

      <ConfirmDialog isOpen={Boolean(holidayToDelete)} onClose={() => setHolidayToDelete(null)} onConfirm={deleteHoliday} title="Remover data do calendário" message={`Deseja remover ${holidayToDelete?.nome || 'esta data'}? A data voltará a ser considerada normalmente nos indicadores de falta e jornada.`} confirmText="Remover data" danger />
    </div>
  );
}
