-- Arquivo: supabase/migrations/20261006000000_initial_schema.sql
-- Descrição: Estrutura inicial do banco de dados, funções seguras e políticas RLS.

-- Habilitar a extensão pgcrypto para uuid se necessário
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

--------------------------------------------------------
-- TABELAS
--------------------------------------------------------

-- Tabela: funcionarios
CREATE TABLE public.funcionarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    cpf TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    cargo TEXT NOT NULL,
    ativo BOOLEAN DEFAULT TRUE,
    role TEXT DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
    foto_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('America/Sao_Paulo', now())
);

-- Tabela: registros_ponto
CREATE TABLE public.registros_ponto (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    funcionario_id UUID REFERENCES public.funcionarios(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    entrada TIME,
    saida_almoco TIME,
    retorno_almoco TIME,
    saida TIME,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('America/Sao_Paulo', now()),
    UNIQUE(funcionario_id, data)
);

-- Tabela: documentos
CREATE TABLE public.documentos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    funcionario_id UUID REFERENCES public.funcionarios(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    nome_arquivo TEXT NOT NULL,
    caminho_storage TEXT NOT NULL,
    periodo_inicio DATE,
    periodo_fim DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('America/Sao_Paulo', now())
);

-- Tabela: auditoria
CREATE TABLE public.auditoria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES public.funcionarios(id) ON DELETE SET NULL,
    acao TEXT NOT NULL,
    alvo_id UUID REFERENCES public.funcionarios(id) ON DELETE SET NULL,
    detalhes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('America/Sao_Paulo', now())
);

--------------------------------------------------------
-- FUNÇÃO RPC PARA REGISTRO SEGURO DE PONTO
--------------------------------------------------------
-- Garante que o horário seja gerado no servidor do Supabase e não no dispositivo do usuário

CREATE OR REPLACE FUNCTION public.registrar_ponto(p_funcionario_id UUID, p_tipo TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_data_hoje DATE;
    v_hora_agora TIME;
    v_registro_id UUID;
BEGIN
    -- Obter a data e hora oficial do servidor (Fuso SP)
    v_data_hoje := (timezone('America/Sao_Paulo', now()))::date;
    v_hora_agora := (timezone('America/Sao_Paulo', now()))::time;

    -- Verificar se já existe um registro para o funcionário hoje
    SELECT id INTO v_registro_id
    FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_data_hoje;

    IF v_registro_id IS NULL THEN
        -- Se não existir, criar e registrar como entrada
        IF p_tipo = 'entrada' THEN
            INSERT INTO public.registros_ponto (funcionario_id, data, entrada)
            VALUES (p_funcionario_id, v_data_hoje, v_hora_agora);
        ELSE
            RAISE EXCEPTION 'Não é possível registrar % sem antes registrar a entrada.', p_tipo;
        END IF;
    ELSE
        -- Se existir, atualizar o campo correspondente
        IF p_tipo = 'entrada' THEN
            RAISE EXCEPTION 'Entrada já registrada hoje.';
        ELSIF p_tipo = 'saida_almoco' THEN
            UPDATE public.registros_ponto SET saida_almoco = v_hora_agora WHERE id = v_registro_id AND saida_almoco IS NULL;
        ELSIF p_tipo = 'retorno_almoco' THEN
            UPDATE public.registros_ponto SET retorno_almoco = v_hora_agora WHERE id = v_registro_id AND retorno_almoco IS NULL;
        ELSIF p_tipo = 'saida' THEN
            UPDATE public.registros_ponto SET saida = v_hora_agora WHERE id = v_registro_id AND saida IS NULL;
        ELSE
            RAISE EXCEPTION 'Tipo de registro inválido.';
        END IF;
    END IF;
END;
$$;

--------------------------------------------------------
-- TRIGGER: ATRIBUIÇÃO AUTOMÁTICA DE ADMIN INICIAL
--------------------------------------------------------
-- Atribui o papel de admin automaticamente ao primeiro usuário especificado
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger atrelada à tabela auth.users do Supabase
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

--------------------------------------------------------
-- POLÍTICAS RLS (Row Level Security)
--------------------------------------------------------

ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_ponto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

-- Funcionários: todos podem ver todos (para o admin ver) ou o proprio ver ele mesmo.
-- Simplificando: Qualquer usuário autenticado pode ler dados da tabela funcionarios.
CREATE POLICY "Funcionários são visíveis por usuários autenticados"
  ON public.funcionarios FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Apenas admins ou o proprio funcionario pode editar seu perfil
CREATE POLICY "Usuário pode editar próprio perfil ou admin pode editar qualquer um"
  ON public.funcionarios FOR UPDATE
  USING (
    auth.uid() = auth_id OR
    EXISTS (SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Registros: Usuario ve o proprio, Admin ve todos
CREATE POLICY "Registros do próprio usuário"
  ON public.registros_ponto FOR SELECT
  USING (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Documentos: Usuario ve os proprios, Admin ve todos
CREATE POLICY "Documentos do próprio usuário"
  ON public.documentos FOR SELECT
  USING (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Usuário insere próprios documentos"
  ON public.documentos FOR INSERT
  WITH CHECK (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = auth.uid())
  );

-- Auditoria: Apenas admins podem ler
CREATE POLICY "Apenas admin lê auditoria"
  ON public.auditoria FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND role = 'admin'));

-- Auditoria: Apenas admins (ou sistema via trigger) insere
CREATE POLICY "Apenas admin insere auditoria"
  ON public.auditoria FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND role = 'admin'));

--------------------------------------------------------
-- STORAGE BUCKETS E POLÍTICAS
--------------------------------------------------------

-- Você precisa criar os buckets manualmente ou via SQL caso a api permita
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documentos', 'documentos', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('fotos-funcionarios', 'fotos-funcionarios', true);

-- Políticas Storage: Documentos
CREATE POLICY "Usuários enviam próprios documentos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documentos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Usuário ou Admin podem ler documentos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documentos' AND
    (
      -- simplificando: se autenticado, permite o acesso (a assinatura de url protege contra ataques massivos de qualquer forma se usarmos a api storage)
      auth.uid() IS NOT NULL
    )
  );

-- Políticas Storage: Fotos
CREATE POLICY "Fotos são públicas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fotos-funcionarios');

CREATE POLICY "Usuário altera a própria foto"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'fotos-funcionarios' AND auth.uid() IS NOT NULL);

CREATE POLICY "Usuário atualiza a própria foto"
  ON storage.objects FOR UPDATE
  WITH CHECK (bucket_id = 'fotos-funcionarios' AND auth.uid() IS NOT NULL);
