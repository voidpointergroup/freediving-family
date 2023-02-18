import * as ulid from 'ulid'

// parent:A/child:B#test/X:Y#Z
export class ID {
    static readonly ID_SEP = '/'
    static readonly PART_SEP = ':'
    static readonly PATH_SEP = '#'

    public id: string

    constructor(public prefix: string, id?: string, public parent?: ID, public path?: string) {
        if (id) {
            this.id = id
        } else {
            this.id = ulid.ulid().toLowerCase()
        }
    }

    public toString(): string {
        let v = ''
        if (this.parent) {
            v += this.parent.toString() + ID.ID_SEP
        }
        v += `${this.prefix}:${this.id}`
        if (this.path) {
            v += `${ID.PATH_SEP}${this.path}`
        }
        return v
    }

    public static parse(v: string): ID {
        const items = v.split(ID.ID_SEP)
        const local = items[items.length - 1]
        let localParts = local?.split(ID.PART_SEP)
        if (!localParts || localParts.length != 2) {
            throw new Error(`malformed ID ${v}`)
        }
        const pathSplit = localParts[1]!.split(ID.PATH_SEP)
        if (pathSplit.length > 1) {
            localParts = [
                localParts[0]!,
                pathSplit[0]!,
                pathSplit[1]!
            ]
        }

        return new ID(localParts[0]!, localParts[1]!,
            items.length > 1 ? ID.parse(items.slice(0, -1).join(ID.ID_SEP)) : undefined, localParts.length > 2 ? localParts[2] : undefined)
    }
}
