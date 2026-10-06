// Biblioteca de modelos de funil — curada pela 3R.
//
// Todo modelo segue o mesmo esqueleto de funções (ver funcoes.ts): o que muda
// é o nome que o segmento usa para cada passo. Cada etapa traz o critério de
// avanço — o que o CLIENTE fez, não o que o vendedor fez. Motivos de perda e
// campos são os do segmento; ao aplicar, entram na conta só os que faltam.
//
// O "Funil geral 3R" é o esqueleto dos funis que mais movimentam nas contas
// (Pós Engenharia, ILARF, Elas que Vendem) e é o padrão de conta nova.

import { funcaoInfo, type FuncaoEtapa } from './funcoes'

export interface EtapaModelo {
  nome: string
  funcao: FuncaoEtapa
  /** O que precisa ter acontecido para o negócio estar aqui. */
  criterio: string
  /** Prazo na etapa; se omitido, vale o padrão da função (funcoes.ts). */
  diasMax?: number
}

export type CategoriaModelo =
  | 'Geral'
  | 'Varejo e consumo'
  | 'Serviços'
  | 'Saúde'
  | 'Educação e eventos'
  | 'Recuperação'

export interface ModeloFunil {
  id: string
  nome: string
  categoria: CategoriaModelo
  /** Uma linha: para quem é. */
  paraQuem: string
  etapas: EtapaModelo[]
  motivosPerda: string[]
  /** Campos de contato (texto) que o segmento costuma precisar. */
  campos: string[]
}

export const CATEGORIAS: CategoriaModelo[] = [
  'Geral',
  'Varejo e consumo',
  'Serviços',
  'Saúde',
  'Educação e eventos',
  'Recuperação',
]

const PERDIDO: EtapaModelo = {
  nome: 'Perdido',
  funcao: 'perdido',
  criterio: 'Não vai comprar agora — registre o motivo.',
}

export const MODELOS: ModeloFunil[] = [
  {
    id: 'geral-3r',
    nome: 'Funil geral 3R',
    categoria: 'Geral',
    paraQuem: 'Qualquer negócio que vende pelo WhatsApp. É o esqueleto dos funis que mais vendem nas contas da 3R.',
    etapas: [
      { nome: 'Base', funcao: 'entrada', criterio: 'O lead entrou (anúncio, formulário, base, indicação).' },
      { nome: 'Prospecção', funcao: 'tentativa', criterio: 'Primeira mensagem ou ligação feita; ainda sem resposta.' },
      { nome: 'Conexão', funcao: 'conexao', criterio: 'O lead respondeu e conversou de verdade.' },
      { nome: 'Possibilidade', funcao: 'qualificado', criterio: 'Tem interesse, perfil e condição de comprar.' },
      { nome: 'Possibilidade quente', funcao: 'compromisso', criterio: 'Pediu condição, link ou combinou o próximo passo.' },
      { nome: 'Aguardando pagamento', funcao: 'decisao', criterio: 'Recebeu o link ou a condição final e vai pagar.' },
      { nome: 'Ganho', funcao: 'ganho', criterio: 'Pagou.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço / orçamento', 'Sem fit (não é o perfil)', 'Sumiu / parou de responder', 'Escolheu concorrente', 'Sem urgência (timing)', 'Não era o decisor', 'Outro'],
    campos: [],
  },
  {
    id: 'varejo-loja',
    nome: 'Loja física + WhatsApp',
    categoria: 'Varejo e consumo',
    paraQuem: 'Lojas de móveis, decoração, eletro, moda e afins que vendem no salão e no WhatsApp.',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Chegou mensagem do anúncio, Instagram ou WhatsApp.' },
      { nome: 'Em atendimento', funcao: 'tentativa', criterio: 'Vendedor respondeu; cliente ainda não engajou.' },
      { nome: 'Conversa ativa', funcao: 'conexao', criterio: 'Cliente contou o que procura (produto, ambiente, prazo).' },
      { nome: 'Visita ao salão', funcao: 'compromisso', criterio: 'Cliente foi à loja ou viu o produto ao vivo / por vídeo.' },
      { nome: 'Orçamento enviado', funcao: 'proposta', criterio: 'Recebeu valor, prazo de entrega e condição de pagamento.' },
      { nome: 'Aguardando pagamento', funcao: 'decisao', criterio: 'Aceitou e está fechando forma de pagamento ou entrada.' },
      { nome: 'Ganho', funcao: 'ganho', criterio: 'Pagou ou deu entrada.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço', 'Prazo de entrega', 'Comprou no concorrente', 'Sem o produto / estoque', 'Desistiu da compra', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Produto de interesse', 'Prazo para comprar'],
  },
  {
    id: 'concessionaria',
    nome: 'Concessionária / veículos',
    categoria: 'Varejo e consumo',
    paraQuem: 'Concessionárias e lojas de veículos novos ou seminovos.',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Chegou interesse por um veículo.' },
      { nome: 'Primeiro contato', funcao: 'tentativa', criterio: 'Vendedor chamou; sem resposta ainda.' },
      { nome: 'Em conversa', funcao: 'conexao', criterio: 'Cliente respondeu e falou do que precisa.' },
      { nome: 'Qualificado', funcao: 'qualificado', criterio: 'Sabemos modelo, forma de pagamento e se tem usado na troca.' },
      { nome: 'Test drive / visita', funcao: 'compromisso', criterio: 'Cliente foi à loja ou fez o test drive.' },
      { nome: 'Proposta enviada', funcao: 'proposta', criterio: 'Recebeu valor, avaliação do usado e condição.' },
      { nome: 'Financiamento / fechamento', funcao: 'decisao', criterio: 'Crédito em análise ou documentação em andamento.', diasMax: 7 },
      { nome: 'Venda fechada', funcao: 'ganho', criterio: 'Contrato assinado ou pagamento feito.' },
      PERDIDO,
    ],
    motivosPerda: ['Crédito negado', 'Avaliação do usado abaixo do esperado', 'Preço', 'Comprou em outra loja', 'Sem o modelo / cor', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Veículo de interesse', 'Usado na troca', 'Forma de pagamento'],
  },
  {
    id: 'energia-solar',
    nome: 'Energia solar',
    categoria: 'Varejo e consumo',
    paraQuem: 'Integradoras e revendas de energia solar residencial ou comercial.',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Chegou pedido de orçamento.' },
      { nome: 'Primeiro contato', funcao: 'tentativa', criterio: 'Chamamos; sem resposta ainda.' },
      { nome: 'Em conversa', funcao: 'conexao', criterio: 'Cliente respondeu.' },
      { nome: 'Conta de luz recebida', funcao: 'qualificado', criterio: 'Mandou a conta; consumo e cidade conhecidos.' },
      { nome: 'Visita técnica', funcao: 'compromisso', criterio: 'Visita técnica feita ou telhado avaliado.', diasMax: 7 },
      { nome: 'Proposta apresentada', funcao: 'proposta', criterio: 'Recebeu projeto, valor e economia estimada.', diasMax: 7 },
      { nome: 'Financiamento / assinatura', funcao: 'decisao', criterio: 'Crédito em análise ou contrato em assinatura.', diasMax: 10 },
      { nome: 'Contrato fechado', funcao: 'ganho', criterio: 'Assinou ou pagou a entrada.' },
      PERDIDO,
    ],
    motivosPerda: ['Financiamento negado', 'Preço', 'Telhado / instalação inviável', 'Fechou com concorrente', 'Vai deixar para depois', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Valor da conta de luz', 'Cidade', 'Tipo de telhado'],
  },
  {
    id: 'imobiliaria',
    nome: 'Imobiliária',
    categoria: 'Serviços',
    paraQuem: 'Imobiliárias e corretores (venda ou locação).',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Chegou interesse por imóvel.' },
      { nome: 'Primeiro contato', funcao: 'tentativa', criterio: 'Corretor chamou; sem resposta ainda.' },
      { nome: 'Em conversa', funcao: 'conexao', criterio: 'Cliente respondeu.' },
      { nome: 'Perfil qualificado', funcao: 'qualificado', criterio: 'Sabemos região, faixa de valor e se vai financiar.' },
      { nome: 'Visita agendada', funcao: 'compromisso', criterio: 'Visita marcada com data e hora.', diasMax: 7 },
      { nome: 'Proposta', funcao: 'proposta', criterio: 'Fez ou recebeu proposta sobre um imóvel.', diasMax: 7 },
      { nome: 'Documentação / crédito', funcao: 'decisao', criterio: 'Proposta aceita; documentos e financiamento em andamento.', diasMax: 20 },
      { nome: 'Fechado', funcao: 'ganho', criterio: 'Contrato assinado.' },
      PERDIDO,
    ],
    motivosPerda: ['Crédito negado', 'Valor acima do orçamento', 'Fechou com outra imobiliária', 'Imóvel vendido / alugado', 'Desistiu', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Tipo de imóvel', 'Faixa de valor', 'Região de interesse', 'Vai financiar'],
  },
  {
    id: 'b2b-consultivo',
    nome: 'Serviços B2B / consultoria',
    categoria: 'Serviços',
    paraQuem: 'Empresas que vendem serviço para outras empresas, com reunião e proposta.',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Chegou indicação, formulário ou contato de lista.' },
      { nome: 'Em contato', funcao: 'tentativa', criterio: 'Abordagem feita; sem resposta ainda.' },
      { nome: 'Conectado', funcao: 'conexao', criterio: 'Falamos com alguém da empresa.' },
      { nome: 'Qualificado', funcao: 'qualificado', criterio: 'Tem a dor, o orçamento e sabemos quem decide.' },
      { nome: 'Reunião realizada', funcao: 'compromisso', criterio: 'Reunião de diagnóstico aconteceu com quem decide.', diasMax: 5 },
      { nome: 'Proposta apresentada', funcao: 'proposta', criterio: 'Proposta discutida com quem decide — não só enviada.', diasMax: 7 },
      { nome: 'Negociação', funcao: 'decisao', criterio: 'Ajustando escopo, preço ou contrato.', diasMax: 10 },
      { nome: 'Ganho', funcao: 'ganho', criterio: 'Contrato assinado ou primeira parcela paga.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço', 'Sem orçamento agora', 'Escolheu concorrente', 'Decisor não aprovou', 'Sem urgência (timing)', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Cargo', 'Tamanho da empresa', 'Faturamento'],
  },
  {
    id: 'prospeccao-sdr',
    nome: 'Prospecção ativa (SDR)',
    categoria: 'Serviços',
    paraQuem: 'Times que abordam listas frias e passam reuniões para o vendedor.',
    etapas: [
      { nome: 'Base fria', funcao: 'entrada', criterio: 'Contato está na lista; ainda não abordado.' },
      { nome: 'Em cadência', funcao: 'tentativa', criterio: 'Recebendo os toques da cadência; sem resposta.', diasMax: 10 },
      { nome: 'Conectado', funcao: 'conexao', criterio: 'Respondeu ou atendeu.' },
      { nome: 'Qualificado', funcao: 'qualificado', criterio: 'É o decisor (ou chegamos nele) e tem a dor.' },
      { nome: 'Reunião agendada', funcao: 'compromisso', criterio: 'Reunião marcada com data, hora e link.', diasMax: 7 },
      { nome: 'Reunião realizada', funcao: 'compromisso', criterio: 'A reunião aconteceu.' },
      { nome: 'Proposta', funcao: 'proposta', criterio: 'Recebeu proposta.', diasMax: 7 },
      { nome: 'Ganho', funcao: 'ganho', criterio: 'Fechou.' },
      { nome: 'No-show / reagendar', funcao: 'reativacao', criterio: 'Faltou à reunião; volta para a cadência.' },
      PERDIDO,
    ],
    motivosPerda: ['Não é o decisor', 'Sem fit (não é o perfil)', 'Sem interesse', 'Já tem fornecedor', 'Faltou e não reagendou', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Cargo', 'Empresa', 'Origem da lista'],
  },
  {
    id: 'seguros',
    nome: 'Corretora de seguros',
    categoria: 'Serviços',
    paraQuem: 'Corretores e corretoras (auto, vida, saúde, empresarial).',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Chegou pedido de cotação ou indicação.' },
      { nome: 'Primeiro contato', funcao: 'tentativa', criterio: 'Chamamos; sem resposta ainda.' },
      { nome: 'Em conversa', funcao: 'conexao', criterio: 'Cliente respondeu.' },
      { nome: 'Dados para cotação', funcao: 'qualificado', criterio: 'Mandou os dados necessários para cotar.' },
      { nome: 'Cotação apresentada', funcao: 'proposta', criterio: 'Recebeu e discutiu as opções de cotação.' },
      { nome: 'Aceitou / pagamento', funcao: 'decisao', criterio: 'Escolheu a opção; proposta e pagamento em andamento.' },
      { nome: 'Apólice emitida', funcao: 'ganho', criterio: 'Apólice emitida e paga.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço', 'Renovou com a seguradora atual', 'Não aprovado na análise', 'Sem necessidade agora', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Tipo de seguro', 'Vencimento da apólice atual'],
  },
  {
    id: 'clinica',
    nome: 'Clínica / saúde',
    categoria: 'Saúde',
    paraQuem: 'Clínicas odontológicas, estéticas, de fisioterapia e consultórios com avaliação.',
    etapas: [
      { nome: 'Novo contato', funcao: 'entrada', criterio: 'Chegou mensagem ou pedido de agendamento.' },
      { nome: 'Em atendimento', funcao: 'tentativa', criterio: 'Respondemos; paciente ainda não engajou.' },
      { nome: 'Em conversa', funcao: 'conexao', criterio: 'Paciente contou o que precisa.' },
      { nome: 'Avaliação agendada', funcao: 'compromisso', criterio: 'Avaliação marcada com data e hora.', diasMax: 7 },
      { nome: 'Compareceu', funcao: 'compromisso', criterio: 'Paciente veio à avaliação.', diasMax: 2 },
      { nome: 'Plano apresentado', funcao: 'proposta', criterio: 'Recebeu plano de tratamento e orçamento.' },
      { nome: 'Fechando', funcao: 'decisao', criterio: 'Aceitou; definindo pagamento e início.' },
      { nome: 'Tratamento fechado', funcao: 'ganho', criterio: 'Pagou ou iniciou o tratamento.' },
      { nome: 'Faltou / remarcar', funcao: 'reativacao', criterio: 'Não compareceu; volta para reagendar.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço do tratamento', 'Convênio não cobre', 'Faltou e não remarcou', 'Fechou com outra clínica', 'Medo / insegurança', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Procedimento de interesse', 'Convênio'],
  },
  {
    id: 'pos-cursos',
    nome: 'Pós-graduação / cursos',
    categoria: 'Educação e eventos',
    paraQuem: 'Instituições e escolas que vendem pós, MBA, cursos livres com turma.',
    etapas: [
      { nome: 'Base', funcao: 'entrada', criterio: 'O lead entrou (anúncio, aula, evento, base).' },
      { nome: 'Prospecção', funcao: 'tentativa', criterio: 'Abordagem feita; sem resposta ainda.' },
      { nome: 'Conexão', funcao: 'conexao', criterio: 'Respondeu e conversou.' },
      { nome: 'Possibilidade', funcao: 'qualificado', criterio: 'Tem a formação exigida e interesse na turma.' },
      { nome: 'Possibilidade quente', funcao: 'compromisso', criterio: 'Pediu condição, link de matrícula ou combinou data.' },
      { nome: 'Aguardando matrícula', funcao: 'decisao', criterio: 'Recebeu o link; falta pagar ou enviar documentos.' },
      { nome: 'Matriculado', funcao: 'ganho', criterio: 'Pagou a matrícula.' },
      { nome: 'Próxima turma', funcao: 'reativacao', criterio: 'Quer, mas não nesta turma; volta na próxima.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço / parcela', 'Sem tempo agora', 'Escolheu outra instituição', 'Não tem a formação exigida', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Curso de interesse', 'Formação'],
  },
  {
    id: 'lancamento',
    nome: 'Lançamento / infoproduto',
    categoria: 'Educação e eventos',
    paraQuem: 'Produtores digitais em lançamento ou perpétuo, com venda assistida no WhatsApp.',
    etapas: [
      { nome: 'Lead captado', funcao: 'entrada', criterio: 'Se inscreveu na aula, lista ou isca.' },
      { nome: 'Prospecção', funcao: 'tentativa', criterio: 'Abordagem feita; sem resposta ainda.' },
      { nome: 'Conexão', funcao: 'conexao', criterio: 'Respondeu e conversou.' },
      { nome: 'Engajado', funcao: 'qualificado', criterio: 'Assistiu à aula ou mostrou interesse claro no produto.' },
      { nome: 'Checkout iniciado', funcao: 'compromisso', criterio: 'Pediu o link ou iniciou a compra.' },
      { nome: 'Aguardando pagamento', funcao: 'decisao', criterio: 'Pix/boleto gerado ou cartão em nova tentativa.', diasMax: 2 },
      { nome: 'Comprou', funcao: 'ganho', criterio: 'Pagamento aprovado.' },
      PERDIDO,
    ],
    motivosPerda: ['Preço', 'Sem tempo agora', 'Não viu valor', 'Cartão recusado', 'Vai esperar a próxima turma', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Produto', 'Origem (aula, anúncio, isca)'],
  },
  {
    id: 'eventos',
    nome: 'Eventos / ingressos',
    categoria: 'Educação e eventos',
    paraQuem: 'Congressos, imersões e eventos presenciais ou online com ingresso.',
    etapas: [
      { nome: 'Novo lead', funcao: 'entrada', criterio: 'Mostrou interesse no evento.' },
      { nome: 'Prospecção', funcao: 'tentativa', criterio: 'Abordagem feita; sem resposta ainda.' },
      { nome: 'Conexão', funcao: 'conexao', criterio: 'Respondeu e conversou.' },
      { nome: 'Interessado', funcao: 'qualificado', criterio: 'Data e local servem; quer ir.' },
      { nome: 'Pré-inscrição', funcao: 'compromisso', criterio: 'Reservou vaga ou pediu o link de pagamento.' },
      { nome: 'Aguardando pagamento', funcao: 'decisao', criterio: 'Link enviado; falta pagar.' },
      { nome: 'Ingresso pago', funcao: 'ganho', criterio: 'Pagou.' },
      PERDIDO,
    ],
    motivosPerda: ['Data não serve', 'Preço', 'Local / distância', 'Desistiu', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Evento', 'Tipo de ingresso'],
  },
  {
    id: 'recuperacao',
    nome: 'Recuperação de vendas',
    categoria: 'Recuperação',
    paraQuem: 'Quem vende online e quer recuperar carrinho abandonado, pix e boleto não pagos e cartão recusado.',
    etapas: [
      { nome: 'Pagamento pendente', funcao: 'entrada', criterio: 'Abandonou o carrinho, gerou pix/boleto sem pagar ou teve o cartão recusado.' },
      { nome: 'Prospecção', funcao: 'tentativa', criterio: 'Mensagem de recuperação enviada; sem resposta.', diasMax: 1 },
      { nome: 'Conexão', funcao: 'conexao', criterio: 'Respondeu.' },
      { nome: 'Motivo entendido', funcao: 'qualificado', criterio: 'Sabemos por que não pagou (limite, dúvida, preço).' },
      { nome: 'Novo link enviado', funcao: 'decisao', criterio: 'Recebeu link ou condição nova e vai pagar.', diasMax: 2 },
      { nome: 'Recuperado', funcao: 'ganho', criterio: 'Pagamento aprovado.' },
      PERDIDO,
    ],
    motivosPerda: ['Cartão sem limite', 'Desistiu da compra', 'Problema no checkout', 'Preço', 'Sumiu / parou de responder', 'Outro'],
    campos: ['Produto', 'Forma de pagamento'],
  },
]

/** Prazo efetivo da etapa: o do modelo, senão o padrão da função. */
export function diasDaEtapa(e: EtapaModelo): number | null {
  return e.diasMax ?? funcaoInfo(e.funcao).diasPadrao
}

export function modeloPorId(id: string): ModeloFunil | undefined {
  return MODELOS.find((m) => m.id === id)
}

export const MODELO_PADRAO_ID = 'geral-3r'
