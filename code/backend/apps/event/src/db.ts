import * as db from '../../../libs/db/src/index'

export const DATABASE = {
    db: 'event',
    collections: {
        events: 'events',
        eventGroups: 'eventGroups'
    }
}

export interface Event extends db.WithID<string> {
    name: string
    starts_at: string
    ends_at: string

    perm_group: db.ForeignKey<string>
}

export interface EventGroup extends db.WithID<string> {
    name: string
    event: db.ForeignKey<string>
    attendees: {
        attendee: db.ForeignKey<string>,
        role: string
    }[]
}
