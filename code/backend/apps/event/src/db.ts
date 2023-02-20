import * as db from '../../../libs/shared/src/db'

export const DATABASE = {
    db: 'ff-event',
    collections: {
        events: 'events',
        eventGroups: 'event_groups',
        eventAttendeeships: 'event_attendeeships'
    }
}

export interface Event extends db.WithID<string> {
    name: string
    starts_at: string
    ends_at: string
    archived: boolean

    perm_groups: db.ForeignKey<string>[]
}

export interface EventGroup extends db.WithID<string> {
    name: string
    event: db.ForeignKey<string>
}

export interface Attendeeship extends db.WithID<string> {
    user: db.ForeignKey<string>
    event_group: db.ForeignKey<string>,
    perm_group: db.ForeignKey<string>
}
