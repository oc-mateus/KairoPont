-- timestamptz stores an instant. Converting now() to a zone-less São Paulo
-- timestamp first made a UTC database store it three hours too early.
-- Preserve historical metadata: its source cannot be inferred from the value.
ALTER TABLE public.funcionarios ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.documentos ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.auditoria ALTER COLUMN created_at SET DEFAULT now();
