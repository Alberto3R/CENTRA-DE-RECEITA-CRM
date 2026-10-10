import { describe, expect, it } from 'vitest'
import { buscarArtigos, linkArtigo, parseDadosAjuda, termosDaPergunta } from './base'

const JS = `window.AJUDA=${JSON.stringify({
  cats: [
    {
      slug: 'canais',
      nome: 'Canais e modelos',
      artigos: [
        { slug: 'conectar-whatsapp', titulo: 'Como conectar o WhatsApp pela API oficial?', resumo: 'Conecte o primeiro número.', quem: 'Proprietário e Administrador', texto: 'Abra Configurações → WhatsApp e preencha o ID do número.' },
        { slug: 'criar-modelo', titulo: 'Como criar um modelo de mensagem do WhatsApp?', resumo: 'Modelo para a Meta aprovar.', quem: 'Proprietário e Administrador', texto: 'Configurações → Modelos → Novo modelo.' },
      ],
    },
    {
      slug: 'agente-3r',
      nome: 'Agente 3R',
      artigos: [
        { slug: 'criar-agente', titulo: 'Como criar ou editar o agente de um canal?', resumo: 'Configure o agente 3R.', quem: 'Proprietário e Administrador', texto: 'Ligue a chave Ativar agente.' },
      ],
    },
  ],
})};\n`

describe('base da Central de Ajuda', () => {
  const artigos = parseDadosAjuda(JS)

  it('lê o dados.js publicado pelo site', () => {
    expect(artigos).toHaveLength(3)
    expect(artigos[2]).toMatchObject({ slug: 'criar-agente', categoria: 'Agente 3R' })
  })

  it('ignora acento e palavras vazias na pergunta', () => {
    expect(termosDaPergunta('Como eu faço a conexão do WhatsApp?')).toEqual(['faco', 'conex', 'whatsa'])
  })

  it('acha o artigo certo pela pergunta em linguagem natural', () => {
    expect(buscarArtigos(artigos, 'como conecto meu whatsapp')[0].slug).toBe('conectar-whatsapp')
    expect(buscarArtigos(artigos, 'quero ligar o agente')[0].slug).toBe('criar-agente')
    expect(buscarArtigos(artigos, 'modelo de mensagem')[0].slug).toBe('criar-modelo')
  })

  it('sem termo útil não devolve nada', () => {
    expect(buscarArtigos(artigos, 'oi')).toEqual([])
  })

  it('link aponta para o artigo na Central pública', () => {
    expect(linkArtigo('criar-agente')).toBe('https://www.centraldereceita.com.br/ajuda#/a/criar-agente')
  })
})

describe('sinônimos', () => {
  it('"vendedor" e "robô" levam aos termos da Central', () => {
    const t = termosDaPergunta('como coloco um vendedor novo e ligo o robô?')
    expect(t).toEqual(expect.arrayContaining(['membro', 'convid', 'agente']))
  })
})
