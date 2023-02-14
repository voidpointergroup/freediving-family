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
import * as netctx from '../../../../libs/netctx/src/index'
import { Lazy } from '../../../../libs/netctx/src/lazy'
import * as bus from '../__generated__/proto/bus/ts/bus/bus'
import * as bus_topics from '../../../../libs/bus/topics.json'
import * as ids from '../../../../libs/ids/src/index'
import * as wkids from '../../../../libs/ids.json'

process.on('SIGINT', function () {
    process.exit()
})

const config = {
    sysconf: yaml.parse(process.env['APP_SYSCONF']!),
    port: 8080
}

interface ServiceDB {
    events: mongo.Collection<db.Event>,
    eventGroups: mongo.Collection<db.EventGroup>,
}

class ServiceContext {
    constructor(public db: ServiceDB, public nc: nats.NatsConnection, public gwctx: netctx.GatewayRequestContext) {
    }

    public async access(action: string, resource: string): Promise<void> {
        const req = bus.Authorize_Request.encode({
            userId: this.gwctx.user.id,
            action: action,
            resourceId: resource
        }).finish()
        const response = await this.nc.request(`${bus_topics.auth.live._root}.${bus_topics.auth.live.authorize}`, req)
        const responseT = bus.Authorize_Response.decode(response.data)
        if (!responseT.permitted) {
            throw new Error(responseT.reason)
        }
    }

    private makeEvent(item: db.Event): ut.DeepPartial<gql.Event> {
        return {
            id: item._id,
            name: item.name,
            starts_at: item.starts_at,
            ends_at: item.ends_at,

            perm_group: {
                id: item.perm_group.ref,
            },
        }
    }

    private makeEventGroup(item: db.EventGroup): ut.DeepPartial<gql.EventGroup> {
        return {
            id: item._id,
            name: item.name,
            members: item.attendees.map(x => {
                return {
                    attendee: {
                        id: x.attendee.ref
                    },
                    role: x.role
                }
            })
        }
    }

    public async readEvent(id: string): Promise<{ db: db.Event, graphql: () => ut.DeepPartial<gql.Event> }> {
        await this.access('read', id)

        const item = await this.db.events.findOne({ '_id': id })
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return this.makeEvent(item)
            }
        }
    }

    public async readEventGroup(id: string): Promise<{ db: db.EventGroup, graphql: () => ut.DeepPartial<gql.EventGroup> }> {
        await this.access('read', id)

        const item = await this.db.eventGroups.findOne({ '_id': id })
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return this.makeEventGroup(item)
            }
        }
    }

    public async findEventGroupsForEvent(eventID: string): Promise<{ db: db.EventGroup, graphql: () => ut.DeepPartial<gql.EventGroup> }[]> {
        const groups = this.db.eventGroups.find({'event.ref': eventID})
        const res: { db: db.EventGroup, graphql: () => ut.DeepPartial<gql.EventGroup> }[] = []
        while (await groups.hasNext()) {
            const g = (await groups.next())!
            res.push({
                db: g,
                graphql: () => {
                    return this.makeEventGroup(g)
                }
            })
        }
        return res
    }
}

interface RequestContext {
    svc: Lazy<ServiceContext>
}

const resolvers: gql.Resolvers<RequestContext> = {
    Query: {
        event: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Event>> => {
            return (await ctx.svc.instance().readEvent(params.id)).graphql()
        },
    },
    Event: {
        groups: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.EventGroup[]>> => {
            return (await ctx.svc.instance().findEventGroupsForEvent(partial.id!)).map(x => x.graphql())
        },
    },
    Mutation: {
        event: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.EventMutation>> => {
            return {}
        },
    },
    EventMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Event>> => {
            await ctx.svc.instance().access('create', new ids.ID(wkids.wellknown.event, wkids.unknown).toString())
            const id = new ids.ID(wkids.wellknown.event)

            const permGroupReq: bus.AddPermissionGroup_Request = {
                name: params.input.name,
                permissions: [{
                    actionRegex: 'read',
                    resourceRegex: `^(${id.toString()}.*)$`
                }],
                extends: []
            }
            const resp = await ctx.svc.instance().nc.request(`${bus_topics.auth.live._root}.${bus_topics.auth.live.create_perm_group}`,
                bus.AddPermissionGroup_Request.encode(permGroupReq).finish())
            const respD = bus.AddPermissionGroup_Response.decode(resp.data)

            const item: db.Event = {
                _id: id.toString(),
                name: params.input.name,
                starts_at: params.input.starts_at,
                ends_at: params.input.ends_at,
                perm_group: {
                    ref: respD.id
                }
            }
            await ctx.svc.instance().db.events.insertOne(item)

            return (await ctx.svc.instance().readEvent(id.toString())).graphql()
        },
        group: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.EventGroupMutation>> => {
            return {}
        },
    },
    EventGroupMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.EventGroup>> => {
            await ctx.svc.instance().access('create', new ids.ID(wkids.wellknown.eventGroup, wkids.unknown, ids.ID.parse(params.event_id)).toString())
            const id = new ids.ID(wkids.wellknown.eventGroup, undefined, ids.ID.parse(params.event_id))
            const item: db.EventGroup = {
                _id: id.toString(),
                name: params.input.name,
                event: {
                    ref: params.event_id,
                },
                attendees: []
            }
            await ctx.svc.instance().db.eventGroups.insertOne(item)

            return (await ctx.svc.instance().readEventGroup(id.toString())).graphql()
        },
    }
}

const schemaString = fs.readFileSync('./res/contract/schema.graphql', { encoding: 'utf-8' })
const typeDefs = gqltag.gql`${schemaString} `
const server = new apollo_server.ApolloServer<RequestContext>({
    schema: apollo_subgraph.buildSubgraphSchema({ typeDefs, resolvers })
})

const mongoClient = new mongo.MongoClient(config.sysconf.database.mongodb.url, {
    directConnection: (process.env['LOCAL'] === '1') ? true : false,
})
const natsConn = await nats.connect({
    servers: config.sysconf.bus.nats.url,
})

await apollo_standalone.startStandaloneServer(server, {
    listen: {
        port: config.port,
    },
    context: async (ctx) => {
        const requestContext = ctx.req.headers['x-request-context'] ? JSON.parse(base64.atob(ctx.req.headers['x-request-context'] as string)) : undefined
        return {
            svc: new Lazy<ServiceContext>(() => new ServiceContext({
                events: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.events),
                eventGroups: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.eventGroups)
            }, natsConn, requestContext))
        }
    }
})