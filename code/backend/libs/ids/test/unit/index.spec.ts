import {describe, expect, test} from '@jest/globals'
import { ID } from '../../src'

describe('IDs', () => {
    test('Creating new ID', async () => {
        const id = new ID('prefix')
        expect(id.prefix).toStrictEqual('prefix')
    })

    test('Creating new ID with given ID part', async () => {
        const id = new ID('prefix', 'some-id')
        expect(id.toString()).toStrictEqual('prefix:some-id')
    })

    test('Creating new ID with given ID part and parent',async () => {
        const id = new ID('prefix', 'B', new ID('parent', 'A'))
        expect(id.toString()).toStrictEqual('parent:A/prefix:B')
    })

    test('Parse multilevel ID', async () => {
        const id = ID.parse('parent:A/prefix:B')
        expect(id.prefix).toStrictEqual('prefix')
        expect(id.id).toStrictEqual('B')
        expect(id.parent).toBeDefined()
        expect(id.parent!.parent).not.toBeDefined()
        expect(id.parent!.prefix).toStrictEqual('parent')
        expect(id.parent!.id).toStrictEqual('A')
    })
})
