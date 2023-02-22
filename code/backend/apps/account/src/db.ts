import * as db from '../../../libs/shared/src/db'

export const DATABASE = {
    db: 'ff-account',
    collections: {
        users: 'users',
        groups: 'groups'
    }
}

export interface User extends db.WithID<string>, db.WithTimestamps {
    name: string
    avatar: string

    permissions: Permission[]
    groups: db.ForeignKey<string>[]
}

export interface Permission {
    action: string
    resource: string
}

export interface Group extends db.WithID<string>, db.WithTimestamps {
    name: string
    active: boolean
    permissions: Permission[]
    extends: db.ForeignKey<string>[]
}
