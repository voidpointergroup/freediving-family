import * as apollo_server from '@apollo/server'
import * as apollo_standalone from '@apollo/server/standalone'
import * as apollo_subgraph from '@apollo/subgraph'
import * as gql from './__generated__/resolvers'
import * as gqltag from 'graphql-tag'
import * as fs from 'fs'
import * as mongo from 'mongodb'
import * as db from './db'
import * as error from './error'
import * as ulid from 'ulid'

interface ServiceDB {
    accounts: mongo.Collection<db.Account>
}
class ServiceContext {
    public db: ServiceDB

    constructor(db: ServiceDB) {
        this.db = db
    }

    public async update<T extends db.WithTimestamps>(coll: mongo.Collection<T>, filter: mongo.Filter<T>, cb: (inDB: T) => Promise<T>): Promise<T> {
        const doc = await coll.findOne(filter) as T | null
        if (!doc) {
            throw error.DocumentNotFound
        }

        await db.autoSetUpdated(doc, async (doc) => {
            await cb(doc)
        })
        await coll.replaceOne(filter, doc)
        return doc
    }

    public mapFixed(v: db.Account): Partial<gql.Account> {
        return {
            id: v._id,
            created_at: v._created_at,
            updated_at: v._updated_at,
        }
    }
}

const resolvers: gql.Resolvers<ServiceContext> = {
    Query: {
        account: async (_, params, svc): Promise<Partial<gql.Account>> => {
            if (!params.id) {
                throw error.Undef('id')
            }

            const doc = await svc.db.accounts.findOne({
                _id: params.id
            })
            if (!doc) {
                throw error.DocumentNotFound
            }

            return svc.mapFixed(doc)
        },
    },
    Mutation: {
        create_account: async (_, params, svc): Promise<Partial<gql.Account>> => {
            const now = new Date(Date.now()).toISOString()
            const doc: db.Account = {
                _id: ulid.ulid().toLowerCase(),
                _created_at: now,
                _updated_at: now,
                name: params.in.name,
            }
            await svc.db.accounts.insertOne(doc)
            return {
                id: doc._id,
            }
        },
        account: async (_, params, _svc): Promise<Partial<gql.AccountMutation>> => {
            return {
                id: params.id,
            }
        }
    },
    Account: {
        name: async (partial, __, svc): Promise<string> => {
            if (!partial.id) {
                throw error.Undef('id')
            }

            const doc = await svc.db.accounts.findOne({
                _id: partial.id
            })
            if (!doc) {
                throw error.DocumentNotFound
            }
            return doc.name
        }
    },
    AccountMutation: {
        update: async (partial, params, svc): Promise<Partial<gql.Account>> => {
            if (!partial.id) {
                throw error.Undef('id')
            }

            const filter = {
                _id: partial.id
            }

            const doc = await svc.update(svc.db.accounts, filter, async (v) => {
                if (params.in.name) {
                    v.name = params.in.name
                }
                return v
            })

            return svc.mapFixed(doc)
        }
    }
}

const schemaString = fs.readFileSync('./res/contract/schema.graphql', { encoding: 'utf-8' })
const typeDefs = gqltag.gql`${schemaString} `
const server = new apollo_server.ApolloServer<ServiceContext>({
    schema: apollo_subgraph.buildSubgraphSchema({ typeDefs, resolvers }),
})

// starting the server
await apollo_standalone.startStandaloneServer(server, {
    listen: {
        port: 8080,
    },
    context: async () => {
        const mongoUrl = 'mongodb://localhost:27017'
        const mongoClient = new mongo.MongoClient(mongoUrl, {
            directConnection: true
        })
        const svc: ServiceContext = new ServiceContext({
            accounts: mongoClient.db('ff-account').collection('accounts')
        })
        return svc
    }
})
