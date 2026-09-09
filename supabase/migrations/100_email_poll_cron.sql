-- ============================================================
-- 100_email_poll_cron.sql — o canal de e-mail passa a RECEBER
--
-- Sem isto o canal é meia via: sai e-mail e a resposta do lead morre numa
-- caixa que ninguém abre. IMAP IDLE resolveria em tempo real, mas não
-- sobrevive em serverless (a conexão persistente morre quando a função
-- responde), então o recebimento é polling — o mesmo desenho dos outros
-- 14 jobs que já rodam aqui.
--
-- 2 minutos é o intervalo: e-mail de prospecção não tem a urgência de um
-- WhatsApp, e cada passada abre uma conexão IMAP na caixa.
-- ============================================================

SELECT cron.schedule(
  'email-poll',
  '*/2 * * * *',
  $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/email/poll',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'broadcast_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cron$
);
