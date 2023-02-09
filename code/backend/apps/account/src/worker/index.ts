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
    users: mongo.Collection<db.User>
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
                switch (msg.subject) {
                case `${bus_topics.auth.live._root}.${bus_topics.auth.live.verify}`:
                    const req = bus.JwtVerificationRequest.decode(msg.data)
                    const resp = await this.verify(req)
                    msg.respond(bus.JwtVerificationResponse.encode(resp).finish(), {})
                    break
                default:
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
                id: '',
                email: '',
                roles: ['admin'],
            }
        }
    }
}

const natsConn = await nats.connect({
    servers: sysconf.bus.nats.url,
})
const mongoUrl = sysconf.database.mongodb.url
const mongoClient = new mongo.MongoClient(mongoUrl, {})

const svc = new ServiceContext({
    users: mongoClient.db('account').collection('users')
}, natsConn)
await svc.run(4)
