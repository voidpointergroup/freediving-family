import * as db from '../../../libs/shared/src/db'

export const DATABASE = {
    db: 'ff-certification',
    collections: {
        certs: 'certs',
        certAttempts: 'cert_attempts',
        certTemplates: 'cert_templates',
        requirementAttempt: 'requirements'
    }
}

export interface CertificateTemplate extends db.WithID<string>, db.WithTimestamps {
    name: string
    requirements: {
        name: string
    }[]
}

export interface Requirement extends db.WithID<string> {
    name: string
    attempt: db.ForeignKey<string>

    observed: {
        by: db.ForeignKey<string>
        at: string
    } | undefined
    approved: {
        by: db.ForeignKey<string>
        at: string
    } | undefined
}

export interface CertificateAttempt extends db.WithID<string>, db.WithTimestamps {
    name: string
    student: db.ForeignKey<string>
    observer: db.ForeignKey<string>
    approver: db.ForeignKey<string>

    started_at: string
    ends_at: string

    requirements: db.ForeignKey<string>[]
}

export interface Certificate extends db.WithID<string>, db.WithTimestamps {
    name: string
    student: db.ForeignKey<string>

    awarded: {
        by: db.ForeignKey<string>
        at: string
    }
}
