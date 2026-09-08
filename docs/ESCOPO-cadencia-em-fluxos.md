# Escopo — cadência dentro de Fluxos (nó de espera)

**Contexto:** hoje cada régua de toques é uma edge function própria — `diag-cadencia`,
`diag-reengajamento`, `ccc-acompanhamento`. Régua nova = código novo, e o dono do
comercial não consegue mexer em nada sem um dev. O incidente de 02→08/set (a mesma
abertura reenviada 11× por dia para os mesmos leads) nasceu dessa arquitetura: cada
função reinventa o controle de estado, e o que estava errado era justamente o controle
de estado.

O motor de **Fluxos** já resolve a parte difícil: guarda o estado de cada lead em
`flow_runs`, tem editor visual, condição, tag e handoff. Falta a peça que uma cadência
exige e ele não tem: **esperar tempo**.

## O que falta no motor (verificado no código, 08/set/2026)

| Peça | Estado hoje |
|---|---|
| Nós | `start`, `send_message`, `send_buttons`, `send_list`, `send_media`, `collect_input`, `condition`, `set_tag`, `handoff`, `end` — **nenhum de espera** |
| Suspensão | O run só suspende esperando **resposta do cliente**. Não existe suspensão por tempo |
| Retomada | Só a mensagem do lead retoma um run. Não há agendador |
| Gatilhos | `keyword`, `first_inbound_message`, `manual`, `deal_stage` |
| Envio ativo | `send_message` é para janela de 24h aberta. Template (HSM) só no gatilho `deal_stage` |

## Escopo mínimo para a régua do Diagnóstico caber em um fluxo

1. **Nó `wait`** — `{ dias, horas }` e, opcionalmente, "só em horário comercial"
   (a régua atual roda 09h–19h; mandar toque às 3h da manhã queima o lead).
2. **`flow_runs.resume_at`** + worker `flows-resume` (pg_cron, 1 min) que retoma os
   runs vencidos. É o que transforma "esperar resposta" em "esperar tempo".
3. **Nó `send_template`** — envio ativo fora da janela de 24h, que é o caso de toda
   cadência de reengajamento. A mecânica já existe em `flows/meta-send.ts` e no
   gatilho `deal_stage`; falta expor como nó.
4. **Parada na resposta** — numa cadência, a resposta do lead **encerra** o fluxo e
   passa para o humano/IA. Hoje a resposta é o que faz o run *avançar*. Precisa ser
   um comportamento do fluxo ("interromper se o lead responder"), não um nó.
5. **Idempotência reaproveitada** — cada nó de envio reserva o toque em
   `outbound_touches` (`reservar_toque`, migração 096) antes de mandar. É o que
   garante que um bug no motor não vire mensagem repetida — a lição do incidente.

## Fora do escopo mínimo (deixar para depois)

- Gatilho "parado há N dias na etapa" (a régua atual entra por `deal_stage` + espera).
- Ramificação por resposta de botão dentro da cadência.
- Editor visual do nó de espera com preview de calendário.

## Migração da régua do Diagnóstico

1. Montar o fluxo equivalente (5 toques, esperas 2h/1d/2d/3d/4d, parada na resposta).
2. Rodar em **sombra**: o fluxo registra o que faria em `flow_run_events`, sem enviar,
   enquanto a `diag-cadencia` segue mandando. Comparar uma semana.
3. Virar a chave: desligar o cron `diag-cadencia`, ligar o fluxo.
4. `diag-reengajamento` e a esteira CCC migram depois, pelo mesmo caminho.

Durante a transição as duas máquinas coexistem sem risco de duplicidade: o
`reservar_toque` e a trava de 24h do motor de disparo valem para as duas.

## Decisões que precisam do dono do produto

1. **Espera em horário comercial** entra no MVP ou fica para depois? (recomendo: entra —
   sem isso, um toque de "+1 dia" às 22h vira mensagem às 22h do dia seguinte)
2. **Resposta do lead encerra ou pausa** o fluxo? (recomendo: encerra e faz handoff,
   que é o comportamento da régua atual)
3. Régua atual é copiada **como está** ou é hora de revisar os intervalos e textos?
