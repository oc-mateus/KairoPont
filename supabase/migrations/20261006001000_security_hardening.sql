-- Remove permissive policies and privilege escalation paths from the initial schema.
-- Apply after 20261006000000_initial_schema.sql.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS "Funcionários são visíveis por usuários autenticados" ON public.funcionarios;
DROP POLICY IF EXISTS "Usuário pode editar próprio perfil ou admin pode editar qualquer um" ON public.funcionarios;
DROP POLICY IF EXISTS "Registros do próprio usuário" ON public.registros_ponto;
DROP POLICY IF EXISTS "Documentos do próprio usuário" ON public.documentos;
DROP POLICY IF EXISTS "Usuário insere próprios documentos" ON public.documentos;
DROP POLICY IF EXISTS "Apenas admin lê auditoria" ON public.auditoria;
DROP POLICY IF EXISTS "Apenas admin insere auditoria" ON public.auditoria;

CREATE POLICY "Funcionário lê o próprio perfil; admin lê todos"
  ON public.funcionarios FOR SELECT TO authenticated
  USING (auth_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

CREATE POLICY "Funcionário atualiza somente o próprio perfil; admin atualiza perfis"
  ON public.funcionarios FOR UPDATE TO authenticated
  USING (auth_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  WITH CHECK (auth_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

-- A RLS controla linhas; limitar colunas impede que um funcionário altere role/ativo/auth_id.
REVOKE UPDATE ON public.funcionarios FROM authenticated;
GRANT UPDATE (nome, cargo, foto_url) ON public.funcionarios TO authenticated;

CREATE POLICY "Funcionário lê os próprios registros; admin lê todos"
  ON public.registros_ponto FOR SELECT TO authenticated
  USING (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid()))
    OR (SELECT public.is_admin())
  );

CREATE POLICY "Funcionário lê os próprios documentos; admin lê todos"
  ON public.documentos FOR SELECT TO authenticated
  USING (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid()))
    OR (SELECT public.is_admin())
  );

CREATE POLICY "Funcionário envia somente os próprios documentos"
  ON public.documentos FOR INSERT TO authenticated
  WITH CHECK (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid()))
  );

CREATE POLICY "Somente admin lê auditoria"
  ON public.auditoria FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE INSERT, UPDATE, DELETE ON public.auditoria FROM authenticated;

-- Role/status só podem ser alterados pela rotina de administração no banco.
CREATE OR REPLACE FUNCTION public.admin_update_employee(
  p_funcionario_id uuid,
  p_ativo boolean,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('employee', 'admin') THEN
    RAISE EXCEPTION 'Perfil inválido.';
  END IF;

  SELECT id INTO v_admin_id FROM public.funcionarios WHERE auth_id = auth.uid();
  UPDATE public.funcionarios
  SET ativo = p_ativo, role = p_role
  WHERE id = p_funcionario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.';
  END IF;

  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (v_admin_id, 'atualizar_funcionario', p_funcionario_id,
          jsonb_build_object('ativo', p_ativo, 'role', p_role));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_employee(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee(uuid, boolean, text) TO authenticated;

-- The signup trigger never grants admin. Promote the verified, intended account separately
-- from the Supabase SQL editor after confirming its identity and email ownership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.funcionarios (auth_id, email, nome, cpf, cargo, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'nome', 'Usuário ' || new.id),
    COALESCE(new.raw_user_meta_data->>'cpf', 'PENDENTE'),
    COALESCE(new.raw_user_meta_data->>'cargo', 'Pendente'),
    'employee'
  );
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_data date := (timezone('America/Sao_Paulo', now()))::date;
  v_hora time := (timezone('America/Sao_Paulo', now()))::time;
  v_registro public.registros_ponto%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true
  ) THEN
    RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_registro FROM public.registros_ponto
  WHERE funcionario_id = p_funcionario_id AND data = v_data FOR UPDATE;

  IF NOT FOUND THEN
    IF p_tipo <> 'entrada' THEN
      RAISE EXCEPTION 'A entrada deve ser registrada primeiro.';
    END IF;
    INSERT INTO public.registros_ponto (funcionario_id, data, entrada)
    VALUES (p_funcionario_id, v_data, v_hora);
    RETURN;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN RAISE EXCEPTION 'Entrada já registrada hoje.';
    WHEN 'saida_almoco' THEN
      IF v_registro.entrada IS NULL OR v_registro.saida_almoco IS NOT NULL THEN
        RAISE EXCEPTION 'Sequência de ponto inválida.';
      END IF;
      UPDATE public.registros_ponto SET saida_almoco = v_hora WHERE id = v_registro.id;
    WHEN 'retorno_almoco' THEN
      IF v_registro.saida_almoco IS NULL OR v_registro.retorno_almoco IS NOT NULL THEN
        RAISE EXCEPTION 'Sequência de ponto inválida.';
      END IF;
      UPDATE public.registros_ponto SET retorno_almoco = v_hora WHERE id = v_registro.id;
    WHEN 'saida' THEN
      IF v_registro.retorno_almoco IS NULL OR v_registro.saida IS NOT NULL THEN
        RAISE EXCEPTION 'Sequência de ponto inválida.';
      END IF;
      UPDATE public.registros_ponto SET saida = v_hora WHERE id = v_registro.id;
    ELSE RAISE EXCEPTION 'Tipo de registro inválido.';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;

-- Keep medical documents private. Create missing buckets without overwriting existing settings.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false), ('fotos-funcionarios', 'fotos-funcionarios', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Usuários enviam próprios documentos" ON storage.objects;
DROP POLICY IF EXISTS "Usuário ou Admin podem ler documentos" ON storage.objects;
DROP POLICY IF EXISTS "Fotos são públicas" ON storage.objects;
DROP POLICY IF EXISTS "Usuário altera a própria foto" ON storage.objects;
DROP POLICY IF EXISTS "Usuário atualiza a própria foto" ON storage.objects;

CREATE POLICY "Funcionário envia documento para a própria pasta"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Funcionário ou admin lê documento autorizado"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos' AND (
      EXISTS (
        SELECT 1 FROM public.funcionarios f
        WHERE f.auth_id = (SELECT auth.uid()) AND f.id::text = (storage.foldername(name))[1]
      ) OR (SELECT public.is_admin())
    )
  );

CREATE POLICY "Fotos públicas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fotos-funcionarios');

CREATE POLICY "Funcionário envia foto para a própria pasta"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fotos-funcionarios' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Funcionário atualiza foto na própria pasta"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fotos-funcionarios' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.id::text = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'fotos-funcionarios' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.id::text = (storage.foldername(name))[1]
    )
  );
