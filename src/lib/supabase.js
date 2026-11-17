import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias. ' +
    'Copie .env.example para .env e preencha os valores.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export async function fetchAllRows(buildQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export function fetchTimesheetRows(employeeId, start, end) {
  return fetchAllRows(() => supabase.from('registros_ponto').select('*')
    .eq('funcionario_id', employeeId).gte('data', start).lte('data', end)
    .order('data', { ascending: true }).order('id'));
}

export async function fetchTimesheetReport(employeeId, start, end) {
  const { data, error } = await supabase.rpc('get_timesheet_report', {
    p_funcionario_id: employeeId, p_inicio: start, p_fim: end,
  });
  if (error) throw error;
  return { records: data.registros, downloadedAt: new Date(data.emitido_em) };
}
