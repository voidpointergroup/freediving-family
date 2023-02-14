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

process.on('SIGINT', function() {
    process.exit()
})

const config = {
    sysconf: yaml.parse(process.env['APP_SYSCONF']!),
    port: 8080
}

interface ServiceDB {
    certs: mongo.Collection<db.Certificate>,
    certAttempts: mongo.Collection<db.CertificateAttempt>,
    certTemplates: mongo.Collection<db.CertificateTemplate>,
}

class ServiceContext {
    constructor(public db: ServiceDB, public nc: nats.NatsConnection, public gwctx: netctx.GatewayRequestContext) {
    }

    public async access(action: string, resource: string): Promise<void> {
        const req = bus.AuthorizeRequest.encode({
            userId: this.gwctx.user.id,
            action: action,
            resourceId: resource
        }).finish()
        const response = await this.nc.request(`${bus_topics.auth.live._root}.${bus_topics.auth.live.authorize}`, req)
        const responseT = bus.AuthorizeResponse.decode(response.data)
        if (!responseT.permitted) {
            throw new Error(responseT.reason)
        }
    }

    public async readCert(id: string): Promise<{db: db.Certificate, graphql: () => ut.DeepPartial<gql.Cert>}> {
        await this.access('read', id)

        const item = await this.db.certs.findOne({'_id': id})
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return {
                    id: item._id,
                    name: item.name,
                    awarded_by: {
                        id: item.awarded.by.ref,
                    },
                    awarded_at: item.awarded.at
                }
            }
        }
    }

    public async readCertAttempt(id: string): Promise<{db: db.CertificateAttempt, graphql: () => ut.DeepPartial<gql.CertAttempt>}> {
        await this.access('read', id)

        const item = await this.db.certAttempts.findOne({'_id': id})
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return {
                    id: item._id,
                    name: item.name,
                    started_at: item.started_at,
                    ends_at: item.ends_at,
                    student: {
                        id: item.student.ref,
                    },
                }
            }
        }
    }

    public async readCertTemplate(id: string): Promise<{db: db.CertificateTemplate, graphql: () => ut.DeepPartial<gql.CertTemplate>}> {
        await this.access('read', id)

        const item = await this.db.certTemplates.findOne({'_id': id})
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return {
                    id: item._id,
                    name: item.name,
                    requirements: item.requirements.map(x => {
                        return {
                            name: x.name,
                        }
                    })
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
        cert: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Cert>> => {
            return (await ctx.svc.instance().readCert(params.id)).graphql()
        },
        cert_attempt: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.CertAttempt>> => {
            return (await ctx.svc.instance().readCertAttempt(params.id)).graphql()
        },
        cert_template: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.CertTemplate>> => {
            return (await ctx.svc.instance().readCertTemplate(params.id)).graphql()
        },
    },
    CertAttempt: {
        requirements: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.Requirement[]>> => {
            const item = await ctx.svc.instance().readCertAttempt(partial.id!)
            return item.db.requirements.map(x => {
                return {
                    id:  x._id,
                    name: x.name,
                    observed_by: x.observed ? { id: x.observed.by.ref } : undefined,
                    observed_at: x.observed ? x.observed.at : undefined,
                    approved_by: x.approved ? { id: x.approved.by.ref } : undefined,
                    approved_at: x.approved ? x.approved.at : undefined,
                }
            })
        },
    },
    Mutation: {
        cert_attempt: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.CertAttemptMutation>> => {
            return {}
        },
        cert_template: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.CertTemplateMutation>> => {
            return {}
        },
    },
    CertAttemptMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.CertAttempt>> => {
            await ctx.svc.instance().access('create', new ids.ID(wkids.wellknown.certAttempt, wkids.unknown).toString())

            const id = new ids.ID(wkids.wellknown.certAttempt)
            const template = await ctx.svc.instance().readCertAttempt(params.input.cert_template_id.toString())
            const now = new Date().toISOString()
            const item: db.CertificateAttempt = {
                _id: id.toString(),
                _created_at: now,
                _updated_at: now,
                started_at: now,
                ends_at: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
                student: {
                    ref: params.input.student_id,
                },
                name: template.db.name,
                requirements: template.db.requirements.map(x => {
                    return {
                        _id: new ids.ID(wkids.wellknown.requirement).toString(),
                        observed: undefined,
                        approved: undefined,
                        name: x.name,
                    }
                })
            }
            await ctx.svc.instance().db.certAttempts.insertOne(item)
            return (await ctx.svc.instance().readCertAttempt(id.toString())).graphql()
        },
    },
    CertTemplateMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.CertTemplate>> => {
            await ctx.svc.instance().access('create', new ids.ID(wkids.wellknown.certTemplate, wkids.unknown).toString())

            const id = new ids.ID(wkids.wellknown.certTemplate)
            const now = new Date().toISOString()
            const item: db.CertificateTemplate = {
                _id: id.toString(),
                _created_at: now,
                _updated_at: now,
                name: params.input.name,
                requirements: params.input.requirements.map(x => {
                    return {
                        name: x
                    }
                })
            }
            await ctx.svc.instance().db.certTemplates.insertOne(item)
            return (await ctx.svc.instance().readCertTemplate(id.toString())).graphql()
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
                certs: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.certs),
                certAttempts: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.certAttempts),
                certTemplates: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.certTemplates),
            }, natsConn, requestContext))
        }
    }
})
