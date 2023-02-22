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
import * as netctx from '../../../../libs/shared/src/gateway'
import { Lazy } from '../../../../libs/shared/src/lazy'
import * as buslive from '../../../../libs/bus/ts/__generated__/proto/bus/live'
import * as bus_topics from '../../../../libs/bus/topics.json'
import * as ids from '../../../../libs/shared/src/id'
import * as wkids from '../../../../libs/ids.json'
import * as bushelper from '../../../../libs/shared/src/bus'

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
    attendeeships: mongo.Collection<db.Attendeeship>,
}

class ServiceContext {
    public authHelper: bushelper.Auth

    constructor(public db: ServiceDB, public nc: nats.NatsConnection, public gwctx: netctx.GatewayRequestContext) {
        this.authHelper = new bushelper.Auth(nc)
    }

    public async access(action: string, resource: string): Promise<boolean> {
        const req = buslive.Authorize_Request.encode({
            userId: this.gwctx.user.id,
            action: action,
            resourceId: resource
        }).finish()
        const response = await this.nc.request(bus_topics.auth.live.authorize, req)
        return buslive.Authorize_Response.decode(response.data).permitted
    }

    private makeEvent(item: db.Event): ut.DeepPartial<gql.Event> {
        return {
            id: item._id,
            name: item.name,
            starts_at: item.starts_at,
            ends_at: item.ends_at,
            archived: item.archived,

            perm_groups: item.perm_groups.map(x => {
                return {
                    id: x.ref
                }
            })
        }
    }

    private makeEventGroup(item: db.EventGroup): ut.DeepPartial<gql.EventGroup> {
        return {
            id: item._id,
            name: item.name,
        }
    }

    private makeAttendeeship(item: db.Attendeeship): ut.DeepPartial<gql.EventAttendeeship> {
        return {
            id: item._id,
            attendee: {
                id: item.user.ref
            },
            event_group: {
                id: item.event_group.ref
            },
            perm_group: {
                id: item.perm_group.ref
            }
        }
    }

    public async readEvents(includeArchived: boolean | undefined): Promise<{ db: db.Event, graphql: () => ut.DeepPartial<gql.Event> }[]> {
        let filter: mongo.Filter<db.Event> = {}
        if (includeArchived !== undefined) {
            filter = {
                ...filter,
                archived: includeArchived
            }
        }
        const cursor = this.db.events.find(filter)

        const events = []
        while (await cursor.hasNext()) {
            const event = (await cursor.next())!
            if (!(await this.authHelper.mayAccess(this.gwctx.user.id, 'read', event._id)).permitted) {
                continue
            }

            events.push({
                db: event,
                graphql: () => {
                    return this.makeEvent(event)
                }
            })
        }

        return events
    }

    public async readEvent(id: string): Promise<{ db: db.Event, graphql: () => ut.DeepPartial<gql.Event> }> {
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)

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
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)

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

    public async readAttendeeship(id: string): Promise<{ db: db.Attendeeship, graphql: () => ut.DeepPartial<gql.EventAttendeeship> }> {
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)

        const item = await this.db.attendeeships.findOne({ '_id': id })
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return this.makeAttendeeship(item)
            }
        }
    }

    public async findEventGroupsForEvent(eventID: string): Promise<{ db: db.EventGroup, graphql: () => ut.DeepPartial<gql.EventGroup> }[]> {
        const groups = this.db.eventGroups.find({ 'event.ref': eventID })
        const res: { db: db.EventGroup, graphql: () => ut.DeepPartial<gql.EventGroup> }[] = []
        while (await groups.hasNext()) {
            const g = (await groups.next())!
            if (!((await this.authHelper.mayAccess(this.gwctx.user.id, 'read', g._id)).permitted)) {
                continue
            }

            res.push({
                db: g,
                graphql: () => {
                    return this.makeEventGroup(g)
                }
            })
        }
        return res
    }

    public async findAttendeeshipsForEventGroup(filter: mongo.Filter<db.Attendeeship>): Promise<{ db: db.Attendeeship, graphql: () => ut.DeepPartial<gql.EventAttendeeship> }[]> {
        const groups = this.db.attendeeships.find(filter)

        const res: { db: db.Attendeeship, graphql: () => ut.DeepPartial<gql.EventAttendeeship> }[] = []
        while (await groups.hasNext()) {
            const g = (await groups.next())!
            if (!((await this.authHelper.mayAccess(this.gwctx.user.id, 'read', g._id)).permitted)) {
                continue
            }

            res.push({
                db: g,
                graphql: () => {
                    return this.makeAttendeeship(g)
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
        events: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Event>[]> => {
            return (await ctx.svc.instance().readEvents(params.params.archived !== undefined ? params.params.archived! : undefined)).map(x => x.graphql())
        },
    },
    Event: {
        __resolveReference: async (partial, ctx): Promise<ut.DeepPartial<gql.Event>> => {
            return (await ctx.svc.instance().readEvent(partial.id!)).graphql()
        },
        event_groups: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.EventGroup[]>> => {
            return (await ctx.svc.instance().findEventGroupsForEvent(partial.id!)).map(x => x.graphql())
        },
    },
    EventGroup: {
        __resolveReference: async (partial, ctx): Promise<ut.DeepPartial<gql.EventGroup>> => {
            return (await ctx.svc.instance().readEventGroup(partial.id!)).graphql()
        },
        attendeeships: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.EventAttendeeship[]>> => {
            return (await ctx.svc.instance().findAttendeeshipsForEventGroup({ 'event_group.ref': partial.id! })).map(x => x.graphql())
        },
    },
    User: {
        attendeeships: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.EventAttendeeship[]>> => {
            return (await ctx.svc.instance().findAttendeeshipsForEventGroup({ 'user.ref': partial.id! })).map(x => x.graphql())
        },
    },
    Mutation: {
        event: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.EventMutation>> => {
            return {}
        },
    },
    EventMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Event>> => {
            const id = new ids.ID(wkids.wellknown.event)
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'create', id.toString())

            const eventPermGroupReq: buslive.AddPermissionGroup_Request = {
                name: `${params.input.name} - Root`,
                permissions: [{
                    actionRegex: 'read',
                    resourceRegex: `^(${id.toString()}.*)$`
                }],
                extends: []
            }
            const eventPermGroupResp = await ctx.svc.instance().nc.request(bus_topics.auth.live.create_perm_group,
                buslive.AddPermissionGroup_Request.encode(eventPermGroupReq).finish())
            const eventPermGroupReqD = buslive.AddPermissionGroup_Response.decode(eventPermGroupResp.data)

            const reqs: buslive.AddPermissionGroup_Request[] = [{
                name: `${params.input.name} - Head Instructors`,
                permissions: [{
                    resourceRegex: `^(${wkids.wellknown.certAttempt}.*)$`,
                    actionRegex: '.*'
                }],
                extends: [eventPermGroupReqD.id]
            }, {
                name: `${params.input.name} - Instructors`,
                permissions: [{
                    resourceRegex: `^(${wkids.wellknown.certAttempt}.*)$`,
                    actionRegex: 'observe'
                }],
                extends: [eventPermGroupReqD.id]
            }, {
                name: `${params.input.name} - Students`,
                permissions: [],
                extends: [eventPermGroupReqD.id]
            }]
            const groupIDs: string[] = [eventPermGroupReqD.id]
            for (const req of reqs) {
                const resp = await ctx.svc.instance().nc.request(bus_topics.auth.live.create_perm_group,
                    buslive.AddPermissionGroup_Request.encode(req).finish())
                const respD = buslive.AddPermissionGroup_Response.decode(resp.data)
                groupIDs.push(respD.id)
            }

            const item: db.Event = {
                _id: id.toString(),
                name: params.input.name,
                starts_at: params.input.starts_at,
                ends_at: params.input.ends_at,
                perm_groups: groupIDs.map(x => {
                    return {
                        ref: x
                    }
                }),
                archived: false
            }
            await ctx.svc.instance().db.events.insertOne(item)

            return (await ctx.svc.instance().readEvent(id.toString())).graphql()
        },
        update: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Event>> => {
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'update', params.id)
            const event = await ctx.svc.instance().readEvent(params.id)

            if (params.in.name !== undefined) {
                event.db.name = params.in.name!
            }
            if (params.in.starts_at !== undefined) {
                event.db.starts_at = params.in.starts_at!
            }
            if (params.in.ends_at !== undefined) {
                event.db.ends_at = params.in.ends_at!
            }
            if (params.in.archived !== undefined) {
                event.db.archived = params.in.archived!
            }
            await ctx.svc.instance().db.events.replaceOne({ '_id': params.id }, event.db)

            return (await ctx.svc.instance().readEvent(params.id)).graphql()
        },
        group: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.EventGroupMutation>> => {
            return {}
        },
    },
    EventGroupMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.EventGroup>> => {
            const id = new ids.ID(wkids.wellknown.eventGroup)
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'create', id.toString())

            const item: db.EventGroup = {
                _id: id.toString(),
                name: params.input.name,
                event: {
                    ref: params.event_id,
                },
            }
            await ctx.svc.instance().db.eventGroups.insertOne(item)

            return (await ctx.svc.instance().readEventGroup(id.toString())).graphql()
        },
        add_attendee: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.EventAttendeeship>> => {
            const id = new ids.ID(wkids.wellknown.eventAttendeeship)
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'create', id.toString())

            const item: db.Attendeeship = {
                _id: id.toString(),
                event_group: {
                    ref: params.event_group_id
                },
                user: {
                    ref: params.input.user_id
                },
                perm_group: {
                    ref: params.input.perm_group_id
                }
            }
            await ctx.svc.instance().db.attendeeships.insertOne(item)

            const busReq: buslive.AddUserToGroup_Request = {
                userId: params.input.user_id,
                groupIds: [params.input.perm_group_id]
            }
            await ctx.svc.instance().nc.request(bus_topics.auth.live.add_user_to_perm_group,
                buslive.AddUserToGroup_Request.encode(busReq).finish())

            return (await ctx.svc.instance().readAttendeeship(id.toString())).graphql()
        },
        remove_attendee: async (_partial, params, ctx): Promise<boolean> => {
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'delete', params.id)

            const att = (await ctx.svc.instance().db.attendeeships.findOne({ '_id': params.id }))!
            await ctx.svc.instance().db.attendeeships.deleteOne({ '_id': params.id })

            const busReq: buslive.RemoveUserFromGroup_Request = {
                userId: att.user.ref,
                groupIds: [att.perm_group.ref]
            }
            await ctx.svc.instance().nc.request(bus_topics.auth.live.remove_user_from_perm_group,
                buslive.RemoveUserFromGroup_Request.encode(busReq).finish())

            return true
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
                eventGroups: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.eventGroups),
                attendeeships: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.eventAttendeeships),
            }, natsConn, requestContext))
        }
    }
})
