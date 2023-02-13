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
import * as ut from 'utility-types'
import * as bus from '../__generated__/proto/bus/ts/bus/bus'
import * as bus_topics from '../../../../libs/bus/topics.json'

process.on('SIGINT', function() {
    process.exit()
})

const sysconf = yaml.parse(process.env['APP_SYSCONF']!)

class Lazy<T> {
    private _initialized = false
    private _field: T | undefined = undefined

    constructor(private _factory: () => T) {}
    public instance(): T {
        if (!this._initialized) {
            this._field = this._factory()
            this._initialized = true
        }
        return this._field!
    }
}

interface ServiceDB {
    users: mongo.Collection<db.User>,
    groups: mongo.Collection<db.Group>
}

interface Identity {
    user: {
        id: string,
    }
}

class ServiceContext {
    constructor(public db: ServiceDB, public nc: nats.NatsConnection, public identity: Identity) {
    }

    private async access(action: string, resource: string): Promise<void> {
        const req = bus.AuthorizeRequest.encode({
            userId: this.identity.user.id,
            action: action,
            resourceId: resource
        }).finish()
        const response = await this.nc.request(`${bus_topics.auth.live._root}.${bus_topics.auth.live.authorize}`, req)
        const responseT = bus.AuthorizeResponse.decode(response.data)
        if (!responseT.permitted) {
            throw new Error(responseT.reason)
        }
    }

    public async readUser(id: string): Promise<{db: db.User, graphql: () => ut.DeepPartial<gql.User>}> {
        await this.access('read', id)

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

    public async readGroup(id: string): Promise<{db: db.Group, graphql: () => ut.DeepPartial<gql.Group>}> {
        await this.access('read', id)

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
                    permissions: group.permissions.map(x => `${x.action}+${x.resource}`),
                }
            }
        }
    }
}

interface RequestContext {
    svc: Lazy<ServiceContext>
}

const resolvers: gql.Resolvers<RequestContext> = {
    Query: {
        myself: async (_partial, _params, ctx): Promise<ut.DeepPartial<gql.User>> => {
            return (await ctx.svc.instance().readUser(ctx.svc.instance().identity.user.id)).graphql()
        },
        user: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.User>> => {
            return (await ctx.svc.instance().readUser(params.id)).graphql()
        },
        group: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Group>> => {
            return (await ctx.svc.instance().readGroup(params.id)).graphql()
        },
    },
    User: {
        __resolveReference: async (partial, ctx, _resolve): Promise<ut.DeepPartial<gql.User>> => {
            return (await ctx.svc.instance().readUser(partial.id!)).graphql()
        },
        groups: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.GroupCollection>> => {
            const user = await ctx.svc.instance().readUser(partial.id!)
            return {
                edges: (await Promise.all(user.db.groups.map(x => ctx.svc.instance().readGroup(x.ref)))).map(x => {
                    return {
                        cursor: x.db._id,
                        node: x.graphql()
                    }
                })
            }
        },
    },
    Group: {
        __resolveReference: async (partial, ctx, _resolve): Promise<ut.DeepPartial<gql.Group>> => {
            return (await ctx.svc.instance().readGroup(partial.id!)).graphql()
        },
        extends: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.GroupCollection>> => {
            const group = await ctx.svc.instance().readGroup(partial.id!)
            return {
                edges: (await Promise.all(group.db.extends.map(x => ctx.svc.instance().readGroup(x.ref)))).map(x => {
                    return {
                        cursor: x.db._id,
                        node: x.graphql()
                    }
                })
            }
        },
    },
    Mutation: {
        user: async (_partial, params, _ctx): Promise<ut.DeepPartial<gql.UserMutation>> => {
            return {
                id: params.id,
            }
        },
        group: async (_partial, params, _ctx): Promise<ut.DeepPartial<gql.GroupMutation>> => {
            return {
                id: params.id,
            }
        },
    },
    UserMutation: {
        update: async (partial, params, ctx): Promise<ut.DeepPartial<gql.User>> => {
            const item = await ctx.svc.instance().db.users.findOne({'_id': partial.id!})
            if (!item) {
                throw error.Undef(partial.id!)
            }
            if (params.input.avatar) {
                item.avatar = params.input.avatar
            }
            await ctx.svc.instance().db.users.replaceOne({'_id': item._id}, item)

            return {
                id: item._id,
            }
        },
    },
    GroupMutation: {
        update: async (partial, params, ctx): Promise<ut.DeepPartial<gql.Group>> => {
            const item = await ctx.svc.instance().db.groups.findOne({'_id': partial.id!})
            if (!item) {
                throw error.Undef(partial.id!)
            }

            if (params.input.extends) {
                item.extends = params.input.extends.map(x => { return { ref: x } } )
            }
            if (params.input.permissions) {
                item.permissions = params.input.permissions.map(x => {
                    const items = x.split('+')
                    if (items.length !== 2) {
                        throw new Error('invalid resource')
                    }
                    return {
                        action: items[0]!,
                        resource: items[1]!
                    }
                })
            }

            await ctx.svc.instance().db.groups.replaceOne({'_id': item._id}, item)

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

await apollo_standalone.startStandaloneServer(server, {
    listen: {
        port: 8080,
    },
    context: async (ctx) => {
        const requestContext = ctx.req.headers['x-request-context'] ? JSON.parse(base64.atob(ctx.req.headers['x-request-context'] as string)) : undefined
        return {
            svc: new Lazy<ServiceContext>(() => new ServiceContext({
                users: mongoClient.db('account').collection('users'),
                groups: mongoClient.db('account').collection('groups')
            }, natsConn, {
                user: {
                    id: requestContext.user.id
                }
            }))
        }
    }
})
