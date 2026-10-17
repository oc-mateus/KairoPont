-- Prevent a forgotten open shift from being silently bypassed by a new entry.
CREATE OR REPLACE FUNCTION public.prevent_stale_open_punch_bypass()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.entrada IS NOT NULL AND NEW.saida IS NULL AND EXISTS (
    SELECT 1
    FROM public.registros_ponto existing
    WHERE existing.funcionario_id = NEW.funcionario_id
      AND existing.entrada IS NOT NULL
      AND existing.saida IS NULL
      AND existing.data < (timezone('America/Sao_Paulo', now()))::date - 1
  ) THEN
    RAISE EXCEPTION 'Há uma jornada antiga sem saída. Peça ao administrador para corrigir o registro antes de iniciar outra jornada.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_stale_open_punch_bypass() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_stale_open_punch_bypass ON public.registros_ponto;
CREATE TRIGGER prevent_stale_open_punch_bypass
  BEFORE INSERT ON public.registros_ponto
  FOR EACH ROW EXECUTE FUNCTION public.prevent_stale_open_punch_bypass();

-- Cover the foreign keys reported by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS auditoria_admin_id_idx
  ON public.auditoria (admin_id);
CREATE INDEX IF NOT EXISTS auditoria_alvo_id_idx
  ON public.auditoria (alvo_id);
CREATE INDEX IF NOT EXISTS documentos_funcionario_id_idx
  ON public.documentos (funcionario_id);
CREATE INDEX IF NOT EXISTS funcionario_convites_convidado_por_idx
  ON public.funcionario_convites (convidado_por);
CREATE INDEX IF NOT EXISTS funcionarios_auth_id_idx
  ON public.funcionarios (auth_id);
CREATE INDEX IF NOT EXISTS solicitacoes_ferias_decidida_por_idx
  ON public.solicitacoes_ferias (decidida_por);
