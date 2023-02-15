import * as mongo from 'mongodb'
import * as db from '../db'
import * as bus from '../__generated__/proto/bus/ts/bus/bus'
import * as bus_topics from '../../../../libs/bus/topics.json'
import * as nats from 'nats'
import * as yaml from 'yaml'
import * as ids from '../../../../libs/ids/src/index'
import * as wkids from '../../../../libs/ids.json'

process.on('SIGINT', function() {
    process.exit()
})

const config = {
    sysconf: yaml.parse(process.env['APP_SYSCONF']!),
    worker: {
        topic: `${bus_topics.auth.live._root}.>`,
        queue: 'e7d64f3a-65ac-4956-958e-062692949539'
    },
}

export interface JwtDetails {
    id: string
    email: string
    roles: string[]
}

interface ServiceDB {
    users: mongo.Collection<db.User>,
    groups: mongo.Collection<db.Group>
}
class ServiceContext {
    public db: ServiceDB
    private nc: nats.NatsConnection

    constructor(db: ServiceDB, natsConn: nats.NatsConnection) {
        this.db = db
        this.nc = natsConn
    }

    private async runWorker(sub: nats.Subscription) {
        for await (const msg of sub) {
            try {
                console.info(`processing message on ${msg.subject}`)
                if (msg.subject === `${bus_topics.auth.live._root}.${bus_topics.auth.live.verify}`) {
                    const req = bus.JwtVerification_Request.decode(msg.data)
                    console.info(JSON.stringify(req))
                    const resp = await this.verify(req)
                    console.info(JSON.stringify(resp))
                    msg.respond(bus.JwtVerification_Response.encode(resp).finish(), {})
                } else if (msg.subject === `${bus_topics.auth.live._root}.${bus_topics.auth.live.authorize}`) {
                    const req = bus.Authorize_Request.decode(msg.data)
                    console.info(JSON.stringify(req))
                    const resp = await this.authorize(req)
                    console.info(JSON.stringify(resp))
                    msg.respond(bus.Authorize_Response.encode(resp).finish(), {})
                } else if (msg.subject === `${bus_topics.auth.live._root}.${bus_topics.auth.live.create_perm_group}`) {
                    const req = bus.AddPermissionGroup_Request.decode(msg.data)
                    console.info(JSON.stringify(req))
                    const resp = await this.createPermGroup(req)
                    console.info(JSON.stringify(resp))
                    msg.respond(bus.AddPermissionGroup_Response.encode(resp).finish(), {})
                } else if (msg.subject === `${bus_topics.auth.live._root}.${bus_topics.auth.live.add_user_to_perm_group}`) {
                    const req = bus.AddUserToGroup_Request.decode(msg.data)
                    console.info(JSON.stringify(req))
                    const resp = await this.addUserToPermGroup(req)
                    console.info(JSON.stringify(resp))
                    msg.respond(bus.AddUserToGroup_Response.encode(resp).finish(), {})
                } else {
                    throw new Error(`unknown subject ${msg.subject}`)
                }
            } catch (error) {
                console.error(error)
            }
        }
        console.error('(supposedly) infinite worker done')
    }

    public async run(workers: number): Promise<void> {
        const sub = this.nc.subscribe(config.worker.topic, {
            queue: config.worker.queue,
        })

        const allWorkers = []
        for (let i = 0; i < workers; i++) {
            allWorkers.push(this.runWorker(sub))
        }

        await Promise.any(allWorkers)
    }

    private async verify(req: bus.JwtVerification_Request): Promise<bus.JwtVerification_Response> {
        return {
            ok: true,
            details: {
                id: req.jwt
            }
        }
    }

    private async authorize(req: bus.Authorize_Request): Promise<bus.Authorize_Response> {
        const user = await this.db.users.findOne({'_id': req.userId})
        if (!user) {
            return {
                permitted: false,
                reason: 'user not found'
            }
        }

        const perms = user.permissions.concat(await this.collectGroupPermissions(user.groups.map(x => x.ref)))
        for (const p of perms) {
            const ac = new RegExp(p.action)
            const rc = new RegExp(p.resource)

            if (ac.test(req.action) && rc.test(req.resourceId)) {
                console.info(`authorize ${req.action} for ${req.resourceId} granted for ${req.userId} via rule ("${p.action}" and "${p.resource}")`)
                return {
                    permitted: true,
                }
            }
        }

        console.info(`authorize ${req.action} for ${req.resourceId} denied for ${req.userId}`)
        return {
            permitted: false,
            reason: 'insufficient permissions'
        }
    }

    private async createPermGroup(req: bus.AddPermissionGroup_Request): Promise<bus.AddPermissionGroup_Response> {
        const id = new ids.ID(wkids.wellknown.group)
        const now = new Date().toISOString()
        const grp: db.Group = {
            _id: id.toString(),
            _created_at: now,
            _updated_at: now,
            name: req.name,
            permissions: req.permissions.map(x => {
                return {
                    action: x.actionRegex,
                    resource: x.resourceRegex
                }
            }),
            extends: req.extends.map(x => {
                return {
                    ref: x
                }
            })
        }
        await this.db.groups.insertOne(grp)
        return {
            id: id.toString()
        }
    }

    private async addUserToPermGroup(req: bus.AddUserToGroup_Request): Promise<bus.AddUserToGroup_Response> {
        const group = await this.db.groups.findOne({'_id': req.groupId})
        const user = await this.db.users.findOne({'_id': req.userId})
        if (!group) {
            throw new Error('group not found')
        }
        if (!user) {
            throw new Error('user not found')
        }

        user.groups.push({
            ref: group._id
        })
        await this.db.users.replaceOne({'_id': user._id}, user)
        return {}
    }

    private async collectGroupPermissions(roots: string[]): Promise<db.Permission[]> {
        let groups = roots
        const done = new Set<string>()
        const perms = new Set<db.Permission>()

        while (groups.length > 0) {
            const g = groups.shift()!
            done.add(g)

            const gDb = await this.db.groups.findOne({'_id': g})
            if (!gDb) {
                console.error(`can not find group ${g}`)
                continue
            }
            for (const perm of gDb.permissions) {
                perms.add(perm)
            }
            groups = groups.concat(gDb.extends.map(x => x.ref).filter(x => !done.has(x)))
        }
        return Array.from(perms.values())
    }
}

const natsConn = await nats.connect({
    servers: config.sysconf.bus.nats.url,
})
const mongoUrl = config.sysconf.database.mongodb.url
const mongoClient = new mongo.MongoClient(mongoUrl, {})

const svc = new ServiceContext({
    users: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.users),
    groups: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.groups)
}, natsConn)
await svc.run(4)
