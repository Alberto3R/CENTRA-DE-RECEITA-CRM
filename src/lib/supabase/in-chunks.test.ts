import { describe, expect, it, vi } from 'vitest'
import { chunks, IN_CHUNK, selectAllPages, selectInChunks } from './in-chunks'

const uuids = (n: number) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)

describe('chunks', () => {
  it('fatia sem perder nem repetir item', () => {
    const ids = uuids(697)
    const parts = chunks(ids)
    expect(parts).toHaveLength(7)
    expect(parts.every((p) => p.length <= IN_CHUNK)).toBe(true)
    expect(parts.flat()).toEqual(ids)
  })

  it('cada fatia cabe numa URL curta (o caso das 697 etiquetas dava 27 mil caracteres)', () => {
    const encoded = encodeURIComponent(`(${chunks(uuids(697))[0].join(',')})`)
    expect(encoded.length).toBeLessThan(5000)
  })

  it('lista vazia → nenhuma consulta', () => {
    expect(chunks([])).toEqual([])
  })
})

describe('selectInChunks', () => {
  it('junta as linhas de todas as fatias', async () => {
    const run = vi.fn(async (slice: string[]) => ({ data: slice.map((id) => ({ id })), error: null }))
    const { data, error } = await selectInChunks(uuids(250), run)
    expect(error).toBeNull()
    expect(run).toHaveBeenCalledTimes(3)
    expect(data).toHaveLength(250)
  })

  it('para no primeiro erro e o devolve', async () => {
    let n = 0
    const run = vi.fn(async (slice: string[]) =>
      ++n === 2 ? { data: null, error: { message: 'boom' } } : { data: slice.map((id) => ({ id })), error: null },
    )
    const { data, error } = await selectInChunks(uuids(350), run)
    expect(error?.message).toBe('boom')
    expect(run).toHaveBeenCalledTimes(2)
    expect(data).toHaveLength(100)
  })
})

describe('selectAllPages', () => {
  it('lê além das 1.000 linhas', async () => {
    const all = uuids(2350).map((id) => ({ id }))
    const run = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }))
    const { data } = await selectAllPages(run)
    expect(data).toHaveLength(2350)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('página exata de 1.000 faz mais uma leitura (vazia) e para', async () => {
    const all = uuids(1000).map((id) => ({ id }))
    const run = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }))
    const { data } = await selectAllPages(run)
    expect(data).toHaveLength(1000)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
