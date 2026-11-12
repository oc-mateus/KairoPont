-- Use the current contract for access to vacation history. Keep existing
-- periods and requests available to administrators after a contract change.
ALTER POLICY "Funcionário ativo e admin consultam períodos de férias autorizados"
  ON public.periodos_aquisitivos_ferias USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true AND tipo_contrato = 'clt'
    ) OR (SELECT public.is_admin())
  );

ALTER POLICY "Funcionário ativo e admin consultam solicitações autorizadas"
  ON public.solicitacoes_ferias USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true AND tipo_contrato = 'clt'
    ) OR (SELECT public.is_admin())
  );

ALTER POLICY "Funcionário ativo consulta suas notificações"
  ON public.notificacoes USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true AND tipo_contrato = 'clt'
    )
  );

ALTER POLICY "Funcionário ativo atualiza leitura das próprias notificações"
  ON public.notificacoes USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true AND tipo_contrato = 'clt'
    )
  )
  WITH CHECK (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true AND tipo_contrato = 'clt'
    )
  );
