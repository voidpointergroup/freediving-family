import * as mongo from 'mongodb'
import * as db from '../db'
import * as bus from '../__generated__/proto/bus/ts/bus/bus'
import * as bus_topics from '../../../../libs/bus/topics.json'
import * as nats from 'nats'
import * as yaml from 'yaml'

process.on('SIGINT', function() {
    process.exit()
})

const sysconf = yaml.parse(process.env['APP_SYSCONF']!)

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
                    const req = bus.JwtVerificationRequest.decode(msg.data)
                    const resp = await this.verify(req)
                    msg.respond(bus.JwtVerificationResponse.encode(resp).finish(), {})
                } else if (msg.subject === `${bus_topics.auth.live._root}.${bus_topics.auth.live.authorize}`) {
                    const req = bus.AuthorizeRequest.decode(msg.data)
                    const resp = await this.authorize(req)
                    msg.respond(bus.AuthorizeResponse.encode(resp).finish(), {})
                    break
                } else {
                    throw new Error(`unknown subject ${msg.subject}`)
                }
            } catch (error) {
                console.error(error)
            }
        }
    }

    public async run(workers: number): Promise<void> {
        const sub = this.nc.subscribe(`${bus_topics.auth.live._root}.>`, {
            queue: '8edb90bc-2bff-41cd-b0ed-85a9eb5d59c5',
        })

        const allWorkers = []
        for (let i = 0; i < workers; i++) {
            allWorkers.push(this.runWorker(sub))
        }

        await Promise.any(allWorkers)
    }

    private async verify(_req: bus.JwtVerificationRequest): Promise<bus.JwtVerificationResponse> {
        return {
            ok: true,
            details: {
                id: 'userX'
            }
        }
    }

    private async authorize(req: bus.AuthorizeRequest): Promise<bus.AuthorizeResponse> {
        const user = await this.db.users.findOne({'_id': req.userId})
        if (!user) {
            return {
                permitted: false,
                reason: 'user not found'
            }
        }
        const perms = await this.collectGroupPermissions(user.groups.map(x => x.ref))
        if (perms.indexOf('admin') > -1) {
            return {
                permitted: true,
                reason: 'is admin'
            }
        } else {
            return {
                permitted: false,
                reason: 'unsufficient permissions'
            }
        }
    }

    private async collectGroupPermissions(roots: string[]): Promise<string[]> {
        const groups = roots
        const done = new Set<string>()
        const perms = new Set<string>()

        while (groups.length > 0) {
            const g = groups.shift()!
            done.add(g)

            const gDb = await this.db.groups.findOne({'_id': g})
            if (!gDb) {
                console.error(`can not find group ${g}`)
                continue
            }
            for (const perm in gDb.permissions) {
                perms.add(perm)
            }
            groups.concat(gDb.extends.map(x => x.ref).filter(x => !done.has(x)))
        }
        return Array.from(perms.values())
    }
}

const natsConn = await nats.connect({
    servers: sysconf.bus.nats.url,
})
const mongoUrl = sysconf.database.mongodb.url
const mongoClient = new mongo.MongoClient(mongoUrl, {})

const svc = new ServiceContext({
    users: mongoClient.db('account').collection('users'),
    groups: mongoClient.db('account').collection('groups')
}, natsConn)
await svc.run(4)
