import * as mongo from 'mongodb'
import * as db from '../db'
import * as bus_topics from '../../../../libs/bus/topics.json'
import * as nats from 'nats'
import * as yaml from 'yaml'

const sysconf = yaml.parse(process.env['APP_SYSCONF']!)

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
                const response = undefined
                switch (msg.subject) {
                default:
                    throw new Error(`unknown subject ${msg.subject}`)
                }

                msg.respond(response, {})
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