import * as db from '../../../libs/shared/src/db'

export const DATABASE = {
    db: 'ff-event',
    collections: {
        events: 'events',
        eventGroups: 'event_groups'
    }
}

export interface Event extends db.WithID<string> {
    name: string
    starts_at: string
    ends_at: string

    perm_groups: db.ForeignKey<string>[]
}

export interface EventGroup extends db.WithID<string> {
    name: string
    event: db.ForeignKey<string>
    attendees: {
        attendee: db.ForeignKey<string>,
        role: db.ForeignKey<string>
    }[]
}
