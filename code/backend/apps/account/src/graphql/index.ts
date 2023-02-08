import * as apollo_server from '@apollo/server'
import * as apollo_standalone from '@apollo/server/standalone'
import * as apollo_subgraph from '@apollo/subgraph'
import * as gql from '../__generated__/graphql/resolvers'
import * as gqltag from 'graphql-tag'
import * as fs from 'fs'
import * as mongo from 'mongodb'
import * as db from '../db'
import * as yaml from 'yaml'
import * as nats from 'nats'
import { NatsConnection } from 'nats'

const sysconf = yaml.parse(process.env['APP_SYSCONF']!)

interface ServiceDB {
    users: mongo.Collection<db.User>
}

class ServiceContext {
    constructor(public db: ServiceDB, public nc: NatsConnection) {
    }
}

interface RequestContext {
    svc: ServiceContext
    user: {
        id: string,
        email: string,
        roles: string[],
    }
}

const resolvers: gql.Resolvers<RequestContext> = {
    Query: {
        myself: async (_partial, _params, ctx): Promise<Partial<gql.User>> => {
            return {
                id: ctx.user.id,
                email: '',
            }
        },
    },
    Mutation: {
        user: async (_partial, params, _ctx): Promise<Partial<gql.UserMutation>> => {
            return {
                id: params.id,
            }
        },
    },
    UserMutation: {
        update: async (_partial, _params, ctx): Promise<Partial<gql.User>> => {
            return {
                id: ctx.user.id,
                email: '',
            }
        },
    }
}

const schemaString = fs.readFileSync('./res/contract/schema.graphql', { encoding: 'utf-8' })
const typeDefs = gqltag.gql`${schemaString} `
const server = new apollo_server.ApolloServer<RequestContext>({
    schema: apollo_subgraph.buildSubgraphSchema({ typeDefs, resolvers }),
})

const mongoClient = new mongo.MongoClient(sysconf.database.mongodb.url, {})
const natsConn = await nats.connect({
    servers: sysconf.bus.nats.url,
})
const service: ServiceContext = new ServiceContext({
    users: mongoClient.db('account').collection('users')
}, natsConn)

await apollo_standalone.startStandaloneServer(server, {
    listen: {
        port: 8080,
    },
    context: async (ctx) => {
        const header =  JSON.parse(ctx.req.headers['x-request-context'] as string)
        return {
            svc: service,
            user: {
                id: header.user.id,
                email: header.user.email,
                roles: header.user.roles,
            }
        }
    }
})
