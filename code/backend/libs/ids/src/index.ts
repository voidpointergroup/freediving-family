import * as ulid from 'ulid'

export class ID {
    public id: string

    constructor(public prefix: string, id?: string, public parent?: ID) {
        if (id) {
            this.id = id
        } else {
            this.id = ulid.ulid().toLowerCase()
        }
    }

    public toString(): string {
        let v = ''
        if (this.parent) {
            v += this.parent.toString() + '/'
        }
        v += `${this.prefix}:${this.id}`
        return v
    }

    public static parse(v: string): ID {
        const items = v.split('/')
        const local = items[items.length - 1]
        const localParts = local?.split(':')
        if (!localParts || localParts.length != 2) {
            throw new Error(`malformed ID ${v}`)
        }
        if (items.length > 1) {
            return new ID(localParts[0]!, localParts[1]!, ID.parse(items.slice(0, -1).join('/')))
        } else {
            return new ID(localParts[0]!, localParts[1]!)
        }
    }
}
