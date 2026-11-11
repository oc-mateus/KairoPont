-- Match the portal: an active CLT employee can use their own documents.
-- Active administrators keep cross-employee reads and uploads to their own folder.
ALTER POLICY "Funcionário ativo lê os próprios documentos; admin lê todos"
  ON public.documentos USING (
    (SELECT public.is_admin()) OR EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.id = documentos.funcionario_id
        AND f.auth_id = (SELECT auth.uid()) AND f.ativo = true AND f.tipo_contrato = 'clt'
    )
  );

ALTER POLICY "Funcionário ativo envia somente os próprios documentos"
  ON public.documentos WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.id = documentos.funcionario_id
        AND f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND (f.tipo_contrato = 'clt' OR f.role = 'admin')
    )
    AND tipo IN ('atestado', 'declaracao_horas')
    AND char_length(nome_arquivo) BETWEEN 1 AND 255
    AND (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_fim >= periodo_inicio)
    AND (storage.foldername(caminho_storage))[1] = funcionario_id::text
    AND EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'documentos' AND o.name = documentos.caminho_storage
    )
  );

ALTER POLICY "Funcionário ativo envia documento para a própria pasta"
  ON storage.objects WITH CHECK (
    bucket_id = 'documentos' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND (f.tipo_contrato = 'clt' OR f.role = 'admin')
        AND f.id::text = (storage.foldername(name))[1]
    )
  );

ALTER POLICY "Funcionário ativo ou admin lê documento autorizado"
  ON storage.objects USING (
    bucket_id = 'documentos' AND (
      (SELECT public.is_admin()) OR EXISTS (
        SELECT 1 FROM public.funcionarios f
        WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true AND f.tipo_contrato = 'clt'
          AND f.id::text = (storage.foldername(name))[1]
      )
    )
  );

-- A user who loses document read access must also lose orphan deletion access:
-- an RLS-hidden document must never be mistaken for missing metadata.
ALTER POLICY "Funcionário ativo remove somente documento órfão próprio"
  ON storage.objects USING (
    bucket_id = 'documentos'
    AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND (f.tipo_contrato = 'clt' OR f.role = 'admin')
        AND f.id::text = (storage.foldername(name))[1]
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.documentos d WHERE d.caminho_storage = objects.name
    )
  );
