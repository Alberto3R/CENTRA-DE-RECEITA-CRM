'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { Check } from 'lucide-react';

const steps = [
  { label: 'Modelo', key: 'template' },
  { label: 'Público', key: 'audience' },
  { label: 'Personalizar', key: 'personalize' },
  { label: 'Enviar', key: 'send' },
] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const { createAndSendBroadcast, scheduleBroadcast, isProcessing, progress } =
    useBroadcastSending();

  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [audience, setAudience] = useState<{
    type: 'all' | 'tags' | 'custom_field' | 'csv';
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: 'is' | 'is_not' | 'contains';
      value: string;
    };
    csvContacts?: { phone: string; name?: string }[];
    excludeTagIds?: string[];
  }>({ type: 'all' });
  const [variables, setVariables] = useState<
    Record<string, { type: 'static' | 'field' | 'custom_field'; value: string }>
  >({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');
  // Multi-canal: o canal é escolhido AQUI (no topo) porque os templates são
  // por canal — o Step1 filtra por ele.
  const [channels, setChannels] = useState<
    { id: string; label: string | null; phone_number_id: string; is_primary: boolean | null }[]
  >([]);

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('whatsapp_config')
        .select('id, label, phone_number_id, is_primary')
        .eq('account_id', accountId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });
      const rows = (data ?? []) as typeof channels;
      setChannels(rows);
      setChannelId((prev) => prev || rows[0]?.id || '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleSend() {
    if (!template) return;

    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        template,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
        variables,
        headerMediaUrl,
        channelId: channelId || undefined,
      });
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Falha no disparo';
      console.error('Broadcast failed:', err);
      toast.error(message);
    }
  }

  async function handleSchedule(whenIso: string) {
    if (!template) return;
    try {
      const broadcastId = await scheduleBroadcast(
        {
          name,
          template,
          audience: {
            type: audience.type,
            tagIds: audience.tagIds,
            customField: audience.customField,
            csvContacts: audience.csvContacts,
            excludeTagIds: audience.excludeTagIds,
          },
          variables,
          headerMediaUrl,
          channelId: channelId || undefined,
        },
        whenIso,
      );
      toast.success('Disparo agendado — o servidor envia no horário marcado.');
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao agendar';
      console.error('Schedule failed:', err);
      toast.error(message);
    }
  }

  /**
   * Writes a draft broadcast row — no recipients, no sending. The user
   * can revisit it via the list page to finish the flow later. We
   * don't persist the in-progress audience/variable config here
   * because the current schema doesn't carry it past `audience_filter`
   * and `template_variables`; those are enough for the user to
   * recognize the draft but not to exactly round-trip into the wizard.
   * A full resume-draft UX is a future polish.
   */
  async function handleSaveDraft() {
    if (!template || !name.trim()) {
      toast.error('Dê um nome ao disparo antes de salvar o rascunho.');
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error('Você não está autenticado.');
      return;
    }
    if (!accountId) {
      toast.error('Seu perfil não está vinculado a uma conta.');
      return;
    }

    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      account_id: accountId,
      channel_id: channelId || null,
      name: name.trim(),
      template_name: template.name,
      template_language: template.language ?? 'en_US',
      template_variables: variables,
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
        customField: audience.customField,
        excludeTagIds: audience.excludeTagIds,
      },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(`Falha ao salvar rascunho: ${error.message}`);
      return;
    }
    toast.success('Rascunho salvo');
    router.push('/broadcasts');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Novo Disparo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie e envie uma mensagem de disparo para seus contatos.
        </p>
      </div>

      {/* Canal de envio (multi-canal) — escolhido no início: os modelos são
          por canal. Trocar o canal reinicia a escolha de modelo. */}
      {channels.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Enviar do canal
          </span>
          <select
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setTemplate(null);
              setCurrentStep(0);
            }}
            className="h-8 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
          >
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.label || ch.phone_number_id}
                {ch.is_primary ? ' (primário)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary bg-primary/10 text-primary'
                        : 'border border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive ? 'text-foreground' : isCompleted ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 ${
                    index < currentStep ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step1ChooseTemplate
              selectedTemplate={template}
              onSelect={setTemplate}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/broadcasts')}
              channelId={channelId || undefined}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && template && (
            <Step3Personalize
              template={template}
              variables={variables}
              onUpdate={setVariables}
              headerMediaUrl={headerMediaUrl}
              onHeaderMediaUrlChange={setHeaderMediaUrl}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && template && (
            <Step4ScheduleSend
              name={name}
              onNameChange={setName}
              template={template}
              audience={audience}
              onSend={handleSend}
              onSchedule={handleSchedule}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(2)}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
