-- `timezone('America/Sao_Paulo', now())` returned a timestamp without a zone;
-- PostgreSQL interpreted it as UTC when storing into timestamptz. Convert
-- existing punch creation timestamps back to the actual instant and use now()
-- for future rows so the 96-hour edit window is accurate.
ALTER TABLE public.registros_ponto
  DISABLE TRIGGER prevent_late_punch_record_changes;

UPDATE public.registros_ponto
SET created_at = created_at + interval '3 hours';

ALTER TABLE public.registros_ponto
  ENABLE TRIGGER prevent_late_punch_record_changes;

ALTER TABLE public.registros_ponto
  ALTER COLUMN created_at SET DEFAULT now();
