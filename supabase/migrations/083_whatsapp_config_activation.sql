-- ============================================================
-- whatsapp_config: estado da ativação do número na Cloud API
--
-- Contexto: até aqui o save chamava POST /{phone_number_id}/register
-- direto e torcia. Isso quebra em dois casos comuns de onboarding:
--
--   * o cliente manda o WABA ID achando que é o Phone Number ID;
--   * o número está com code_verification_status = EXPIRED e exige
--     re-verificação por código físico (SMS/ligação) ANTES do register.
--
-- O fluxo novo diagnostica antes de registrar e guarda aqui o que a
-- Meta respondeu, para a UI mostrar o estado real em vez de um
-- "Conectado" otimista.
--
-- Todas as colunas são nullable — linhas existentes sobrevivem e são
-- preenchidas no próximo save ou no próximo diagnóstico.
-- Idempotente: seguro re-rodar.
-- ============================================================

alter table public.whatsapp_config
  add column if not exists pin_encrypted text,
  add column if not exists code_verification_status text,
  add column if not exists platform_type text,
  add column if not exists last_diagnosis_at timestamptz;

-- O PIN (2SV) é exigido em TODA re-conexão futura do número, não só na
-- primeira. Antes ele era usado e descartado, então toda reconexão dependia
-- do cliente lembrar. Guardado cifrado com a mesma chave/rotina do
-- access_token (AES-256-GCM via ENCRYPTION_KEY) — nunca em texto claro,
-- nunca devolvido pela API, nunca exibido na UI.
comment on column public.whatsapp_config.pin_encrypted is
  'PIN de verificação em duas etapas (6 dígitos, criptografado GCM). Necessário em toda re-conexão do número na Cloud API. Nunca retornar ao cliente.';

comment on column public.whatsapp_config.code_verification_status is
  'Último code_verification_status lido da Meta (VERIFIED / EXPIRED / NOT_VERIFIED). EXPIRED exige re-verificar o número com código físico antes de registrar.';

comment on column public.whatsapp_config.platform_type is
  'Último platform_type lido da Meta (CLOUD_API / NOT_APPLICABLE / ON_PREMISE).';

comment on column public.whatsapp_config.last_diagnosis_at is
  'Quando o diagnóstico na Graph API rodou pela última vez. Serve para saber se as colunas de estado acima estão frescas.';
