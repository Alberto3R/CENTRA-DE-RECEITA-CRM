import { describe, expect, it } from 'vitest'
import {
  historyErrorText,
  isCoexistenceWebhookField,
  isFromBusiness,
  isHistoryComplete,
  latestMessage,
  mapHistoryStatus,
  toContentType,
} from './coexistence'

describe('isCoexistenceWebhookField', () => {
  it('reconhece só os 3 campos da coexistência', () => {
    expect(isCoexistenceWebhookField('smb_message_echoes')).toBe(true)
    expect(isCoexistenceWebhookField('history')).toBe(true)
    expect(isCoexistenceWebhookField('smb_app_state_sync')).toBe(true)
    expect(isCoexistenceWebhookField('messages')).toBe(false)
    expect(isCoexistenceWebhookField('calls')).toBe(false)
  })
})

describe('mapHistoryStatus', () => {
  it('traduz os status do histórico para o CHECK de messages.status', () => {
    expect(mapHistoryStatus('READ')).toBe('read')
    expect(mapHistoryStatus('PLAYED')).toBe('read')
    expect(mapHistoryStatus('DELIVERED')).toBe('delivered')
    expect(mapHistoryStatus('ERROR')).toBe('failed')
    expect(mapHistoryStatus('PENDING')).toBe('sending')
    expect(mapHistoryStatus('SENT')).toBe('sent')
    expect(mapHistoryStatus(undefined)).toBe('sent')
  })
})

describe('isFromBusiness', () => {
  it('compara só dígitos', () => {
    expect(isFromBusiness('5561947560298', '+55 61 94756-0298')).toBe(true)
    expect(isFromBusiness('5511999990000', '5561947560298')).toBe(false)
    expect(isFromBusiness('', '')).toBe(false)
  })
})

describe('toContentType', () => {
  it('mantém os tipos aceitos e mapeia o resto', () => {
    expect(toContentType('audio')).toBe('audio')
    expect(toContentType('sticker')).toBe('image')
    expect(toContentType('contacts')).toBe('text')
    expect(toContentType('reaction')).toBe('text')
  })
})

describe('histórico', () => {
  it('só conclui na fase 2 com 100%', () => {
    expect(isHistoryComplete({ metadata: { phase: 2, progress: 100 } })).toBe(true)
    expect(isHistoryComplete({ metadata: { phase: 1, progress: 100 } })).toBe(false)
    expect(isHistoryComplete({ metadata: { phase: 2, progress: 55 } })).toBe(false)
    expect(isHistoryComplete({})).toBe(false)
  })

  it('formata o erro de compartilhamento recusado', () => {
    expect(historyErrorText({})).toBeNull()
    expect(
      historyErrorText({ errors: [{ code: 2593109, title: 'History sharing declined' }] }),
    ).toBe('History sharing declined (código 2593109)')
  })

  it('acha a mensagem mais recente do lote', () => {
    const msgs = [{ timestamp: '10' }, { timestamp: '30' }, { timestamp: '20' }]
    expect(latestMessage(msgs)?.timestamp).toBe('30')
    expect(latestMessage([])).toBeNull()
  })
})
