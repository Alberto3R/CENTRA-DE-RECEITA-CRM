-- ============================================================
-- 097_disparo_automatico_marcado.sql
--
-- A marca `kind='system'` decide duas coisas: se o disparo aparece na tela de
-- Disparos e se a trava anti-repetição do motor vale para ele. Depender de cada
-- origem lembrar de marcar é a mesma fragilidade que causou o incidente da
-- cadência — basta um caminho novo esquecer, e ele volta a poluir a tela e a
-- ficar fora da proteção.
--
-- Aqui a classificação passa a ser do banco: nome no padrão das réguas
-- automáticas nasce 'system', não importa quem inseriu (edge function, API,
-- script, SQL na mão).
-- ============================================================

CREATE OR REPLACE FUNCTION public.classificar_disparo_automatico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'manual' AND (
       NEW.name LIKE 'Diag %' OR
       NEW.name LIKE 'Aviso SDR %' OR
       NEW.name LIKE 'CCC %'
     ) THEN
    NEW.kind := 'system';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_classificar_disparo_automatico ON public.broadcasts;
CREATE TRIGGER trg_classificar_disparo_automatico
  BEFORE INSERT ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.classificar_disparo_automatico();
