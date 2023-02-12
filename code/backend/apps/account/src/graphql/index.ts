import * as apollo_server from '@apollo/server'
import * as apollo_standalone from '@apollo/server/standalone'
import * as apollo_subgraph from '@apollo/subgraph'
import * as gql from '../__generated__/graphql/resolvers'
import * as gqltag from 'graphql-tag'
import * as fs from 'fs'
import * as mongo from 'mongodb'
import * as base64 from 'js-base64'
import * as db from '../db'
import * as yaml from 'yaml'
import * as error from '../error'
import * as nats from 'nats'
import { DeepPartial } from 'utility-types'

process.on('SIGINT', function() {
    process.exit()
})

const sysconf = yaml.parse(process.env['APP_SYSCONF']!)

interface ServiceDB {
    users: mongo.Collection<db.User>,
    groups: mongo.Collection<db.Group>
}

class ServiceContext {
    constructor(public db: ServiceDB, public nc: nats.NatsConnection) {
    }

    public async readUser(id: string): Promise<{db: db.User, graphql: () => DeepPartial<gql.User>}> {
        const user = await this.db.users.findOne({'_id': id})
        if (!user) {
            throw new Error(error.Undef(id))
        }
        return {
            db: user,
            graphql: () => {
                return {
                    id: user._id,
                    name: user.name,
                }
            }
        }
    }

    public async readGroup(id: string): Promise<{db: db.Group, graphql: () => DeepPartial<gql.Group>}> {
        const group = await this.db.groups.findOne({'_id': id})
        if (!group) {
            throw new Error(error.Undef(id))
        }
        return {
            db: group,
            graphql: () => {
                return {
                    id: group._id,
                    name: group._id,
                    permissions: group.permissions,
                }
            }
        }
    }
}

interface RequestContext {
    svc: ServiceContext
    userFn: () => {
        id: string,
    }
}

const resolvers: gql.Resolvers<RequestContext> = {
    Query: {
        myself: async (_partial, _params, ctx): Promise<DeepPartial<gql.User>> => {
            return (await ctx.svc.readUser(ctx.userFn().id)).graphql()
        },
        user: async (_partial, params, ctx): Promise<DeepPartial<gql.User>> => {
            return (await ctx.svc.readUser(params.id)).graphql()
        },
        group: async (_partial, params, ctx): Promise<DeepPartial<gql.Group>> => {
            return (await ctx.svc.readGroup(params.id)).graphql()
        },
    },
    User: {
        __resolveReference: async (partial, ctx, _resolve): Promise<DeepPartial<gql.User>> => {
            return (await ctx.svc.readUser(partial.id!)).graphql()
        },
        groups: async (partial, _params, ctx): Promise<DeepPartial<gql.GroupCollection>> => {
            const user = await ctx.svc.readUser(partial.id!)
            return {
                edges: (await Promise.all(user.db.groups.map(x => ctx.svc.readGroup(x.ref)))).map(x => {
                    return {
                        cursor: x.db._id,
                        node: x.graphql()
                    }
                })
            }
        },
    },
    Group: {
        __resolveReference: async (partial, ctx, _resolve): Promise<DeepPartial<gql.Group>> => {
            return (await ctx.svc.readGroup(partial.id!)).graphql()
        },
        extends: async (partial, _params, ctx): Promise<DeepPartial<gql.GroupCollection>> => {
            const group = await ctx.svc.readGroup(partial.id!)
            return {
                edges: (await Promise.all(group.db.extends.map(x => ctx.svc.readGroup(x.ref)))).map(x => {
                    return {
                        cursor: x.db._id,
                        node: x.graphql()
                    }
                })
            }
        },
    },
    Mutation: {
        user: async (_partial, params, _ctx): Promise<DeepPartial<gql.UserMutation>> => {
            return {
                id: params.id,
            }
        },
        group: async (_partial, params, _ctx): Promise<DeepPartial<gql.GroupMutation>> => {
            return {
                id: params.id,
            }
        },
    },
    UserMutation: {
        update: async (partial, params, ctx): Promise<DeepPartial<gql.User>> => {
            const item = await ctx.svc.db.users.findOne({'_id': partial.id!})
            if (!item) {
                throw error.Undef(partial.id!)
            }
            if (params.input.avatar) {
                item.avatar = params.input.avatar
            }
            await ctx.svc.db.users.replaceOne({'_id': item._id}, item)

            return {
                id: item._id,
            }
        },
    },
    GroupMutation: {
        update: async (partial, params, ctx): Promise<DeepPartial<gql.Group>> => {
            const item = await ctx.svc.db.groups.findOne({'_id': partial.id!})
            if (!item) {
                throw error.Undef(partial.id!)
            }

            if (params.input.extends) {
                item.extends = params.input.extends.map(x => { return { ref: x } } )
            }
            if (params.input.permissions) {
                item.permissions = params.input.permissions
            }

            await ctx.svc.db.groups.replaceOne({'_id': item._id}, item)

            return {
                id: item._id,
            }
        },
    },
}

const schemaString = fs.readFileSync('./res/contract/schema.graphql', { encoding: 'utf-8' })
const typeDefs = gqltag.gql`${schemaString} `
const server = new apollo_server.ApolloServer<RequestContext>({
    schema: apollo_subgraph.buildSubgraphSchema({ typeDefs, resolvers })
})

const mongoClient = new mongo.MongoClient(sysconf.database.mongodb.url, {
    directConnection: (process.env['LOCAL'] === '1') ? true : false,
})

const natsConn = await nats.connect({
    servers: sysconf.bus.nats.url,
})
const service: ServiceContext = new ServiceContext({
    users: mongoClient.db('account').collection('users'),
    groups: mongoClient.db('account').collection('groups')
}, natsConn)

await apollo_standalone.startStandaloneServer(server, {
    listen: {
        port: 8080,
    },
    context: async (ctx) => {
        const requestContext = ctx.req.headers['x-request-context'] ? JSON.parse(base64.atob(ctx.req.headers['x-request-context'] as string)) : undefined
        return {
            svc: service,
            userFn: () => {
                return requestContext.user
            },
        }
    }
})
