export interface WithID<T> {
    _id: T,
}

export interface WithTimestamps {
    _created_at: string,
    _updated_at: string,
}

/**
 * allows updating an object and automatically setting the updated timestamp
 */
export async function autoSetUpdated<T extends WithTimestamps>(doc: T, cb: (old: T) => Promise<void>): Promise<void> {
    await cb(doc)
    doc._updated_at = new Date(Date.now()).toISOString()
}

export interface ForeignKey<T> {
    ref: T
}

export interface User extends WithID<string>, WithTimestamps {
    name: string
    avatar: string

    permissions: Permission[]
    groups: ForeignKey<string>[]
}


export interface Permission {
    action: string
    resource: string
}
export interface Group extends WithID<string>, WithTimestamps {
    permissions: Permission[]
    extends: ForeignKey<string>[]
}
