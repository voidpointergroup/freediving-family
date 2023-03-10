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
    certs: mongo.Collection<db.Certificate>,
    certAttempts: mongo.Collection<db.CertificateAttempt>,
    certTemplates: mongo.Collection<db.CertificateTemplate>,
    requirements: mongo.Collection<db.Requirement>,
}

class ServiceContext {
    public authHelper: bushelper.Auth
    constructor(public db: ServiceDB, public nc: nats.NatsConnection, public gwctx: netctx.GatewayRequestContext) {
        this.authHelper = new bushelper.Auth(nc)
    }

    private makeCert(item: db.Certificate): ut.DeepPartial<gql.Cert> {
        return {
            id: item._id,
            name: item.name,
            awarded_by: {
                id: item.awarded.by.ref,
            },
            awarded_at: item.awarded.at
        }
    }

    private makeCertAttempt(item: db.CertificateAttempt): ut.DeepPartial<gql.CertAttempt> {
        return {
            id: item._id,
            name: item.name,
            started_at: item.started_at,
            ends_at: item.ends_at,
            student: {
                id: item.student.ref
            },
            observer: {
                id: item.observer.ref
            },
            approver: {
                id: item.observer.ref
            }
        }
    }

    private makeRequirement(item: db.Requirement): ut.DeepPartial<gql.Requirement> {
        return {
            id: item._id,
            name: item.name,
            observed_by: item.observed ? { id: item.observed.by.ref } : undefined,
            observed_at: item.observed ? item.observed.at : undefined,
            approved_by: item.approved ? { id: item.approved.by.ref } : undefined,
            approved_at: item.approved ? item.approved.at : undefined,
        }
    }

    public async readCert(id: string): Promise<{ db: db.Certificate, graphql: () => ut.DeepPartial<gql.Cert> }> {
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)

        const item = await this.db.certs.findOne({ _id: id })
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return this.makeCert(item)
            }
        }
    }

    public async readCertAttempt(id: string): Promise<{ db: db.CertificateAttempt, graphql: () => ut.DeepPartial<gql.CertAttempt> }> {
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)

        const item = await this.db.certAttempts.findOne({ _id: id })
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return this.makeCertAttempt(item)
            }
        }
    }

    public async readCertTemplate(id: string): Promise<{ db: db.CertificateTemplate, graphql: () => ut.DeepPartial<gql.CertTemplate> }> {
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)
        const item = await this.db.certTemplates.findOne({ _id: id })
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

    public async readRequirement(id: string): Promise<{ db: db.Requirement, graphql: () => ut.DeepPartial<gql.Requirement> }> {
        await this.authHelper.mustAccess(this.gwctx.user.id, 'read', id)

        const item = await this.db.requirements.findOne({ _id: id })
        if (!item) {
            throw new Error(error.NotFound(id))
        }
        return {
            db: item,
            graphql: () => {
                return this.makeRequirement(item)
            }
        }
    }

    public async findRequirements(filter: mongo.Filter<db.Requirement>): Promise<{ db: db.Requirement, graphql: () => ut.DeepPartial<gql.Requirement> }[]> {
        const reqs = this.db.requirements.find(filter)

        const res: { db: db.Requirement, graphql: () => ut.DeepPartial<gql.Requirement> }[] = []
        while (await reqs.hasNext()) {
            const c = (await reqs.next())!
            if (!(await this.authHelper.mayAccess(this.gwctx.user.id, 'read', c._id)).permitted) {
                continue
            }
            res.push({
                db: c,
                graphql: () => {
                    return this.makeRequirement(c)
                }
            })
        }
        return res
    }

    public async findCerts(filter: mongo.Filter<db.Certificate>): Promise<{ db: db.Certificate, graphql: () => ut.DeepPartial<gql.Cert> }[]> {
        const certs = this.db.certs.find(filter)

        const certsRes: { db: db.Certificate, graphql: () => ut.DeepPartial<gql.Cert> }[] = []
        while (await certs.hasNext()) {
            const c = (await certs.next())!
            if (!(await this.authHelper.mayAccess(this.gwctx.user.id, 'read', c._id)).permitted) {
                continue
            }
            certsRes.push({
                db: c,
                graphql: () => {
                    return this.makeCert(c)
                }
            })
        }
        return certsRes
    }

    public async findCertAttempts(filter: mongo.Filter<db.CertificateAttempt>): Promise<{ db: db.CertificateAttempt, graphql: () => ut.DeepPartial<gql.CertAttempt> }[]> {
        const certs = this.db.certAttempts.find(filter)

        const certsRes: { db: db.CertificateAttempt, graphql: () => ut.DeepPartial<gql.CertAttempt> }[] = []
        while (await certs.hasNext()) {
            const c = (await certs.next())!
            if (!(await this.authHelper.mayAccess(this.gwctx.user.id, 'read', c._id)).permitted) {
                continue
            }
            certsRes.push({
                db: c,
                graphql: () => {
                    return this.makeCertAttempt(c)
                }
            })
        }
        return certsRes
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
        requirement: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Requirement>> => {
            return (await ctx.svc.instance().readRequirement(params.id)).graphql()
        },
        requirements_to_approve: async (_partial, _params, ctx): Promise<ut.DeepPartial<gql.Requirement[]>> => {
            const attempts = await ctx.svc.instance().findCertAttempts({ 'approver.ref': ctx.svc.instance().gwctx.user.id })
            const reqs: ut.DeepPartial<gql.Requirement>[] = []
            for (const att of attempts) {
                for (const req of await ctx.svc.instance().findRequirements({ 'attempt.ref': att.db._id! })) {
                    if (req.db.observed && !req.db.approved) {
                        reqs.push(req.graphql())
                    }
                }
            }
            return reqs
        },
    },
    Requirement: {
        __resolveReference: async (partial, ctx): Promise<ut.DeepPartial<gql.Requirement>> => {
            return (await ctx.svc.instance().readRequirement(partial.id!)).graphql()
        },
    },
    CertTemplate: {
        __resolveReference: async (partial, ctx): Promise<ut.DeepPartial<gql.CertTemplate>> => {
            return (await ctx.svc.instance().readCertTemplate(partial.id!)).graphql()
        },
    },
    Cert: {
        __resolveReference: async (partial, ctx): Promise<ut.DeepPartial<gql.Cert>> => {
            return (await ctx.svc.instance().readCert(partial.id!)).graphql()
        },
    },
    CertAttempt: {
        __resolveReference: async (partial, ctx): Promise<ut.DeepPartial<gql.CertAttempt>> => {
            return (await ctx.svc.instance().readCertAttempt(partial.id!)).graphql()
        },
        requirements: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.Requirement[]>> => {
            const item = await ctx.svc.instance().readCertAttempt(partial.id!)
            return await Promise.all(item.db.requirements.map(async x => {
                return (await ctx.svc.instance().readRequirement(x.ref)).graphql()
            }))
        },
    },
    User: {
        certs: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.Cert[]>> => {
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'read', partial.id!)
            return (await ctx.svc.instance().findCerts({ 'student.ref': partial.id! })).map(x => x.graphql())
        },
        cert_attempts: async (partial, _params, ctx): Promise<ut.DeepPartial<gql.CertAttempt[]>> => {
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'read', partial.id!)
            return (await ctx.svc.instance().findCertAttempts({ 'student.ref': partial.id! })).map(x => x.graphql())
        },
    },
    Mutation: {
        cert_attempt: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.CertAttemptMutation>> => {
            return {}
        },
        cert_template: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.CertTemplateMutation>> => {
            return {}
        },
        requirement: async (_partial, _params, _ctx): Promise<ut.DeepPartial<gql.RequirementMutation>> => {
            return {}
        },
    },
    RequirementMutation: {
        update: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Requirement>> => {
            const item = await ctx.svc.instance().readRequirement(params.id)

            const attempt = await ctx.svc.instance().readCertAttempt(item.db.attempt.ref)
            if (Date.parse(attempt.db.ends_at) < new Date().valueOf()) {
                throw new Error('can not modify - certificate attempt already ended')
            }

            if (params.input.observed) {
                await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'observe', params.id)
                item.db.observed = {
                    at: new Date().toISOString(),
                    by: {
                        ref: ctx.svc.instance().gwctx.user.id
                    }
                }
            }
            if (params.input.approved) {
                await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'approve', params.id)
                item.db.approved = {
                    at: new Date().toISOString(),
                    by: {
                        ref: ctx.svc.instance().gwctx.user.id
                    }
                }
            }
            await ctx.svc.instance().db.requirements.replaceOne({ _id: item.db._id }, item.db)
            return (await ctx.svc.instance().readRequirement(params.id)).graphql()
        },
    },
    CertAttemptMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.CertAttempt>> => {
            const cerattID = new ids.ID(wkids.wellknown.certAttempt)
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'create', cerattID.toString())

            const template = await ctx.svc.instance().readCertTemplate(params.input.cert_template_id.toString())
            const now = new Date().toISOString()

            const reqIDs = new Set<string>
            for (const req of template.db.requirements) {
                const reqID = new ids.ID(wkids.wellknown.requirement, undefined, cerattID).toString()
                await ctx.svc.instance().db.requirements.insertOne({
                    _id: reqID,
                    name: req.name,
                    attempt: {
                        ref: cerattID.toString()
                    },
                    observed: undefined,
                    approved: undefined,
                })
                reqIDs.add(reqID)
            }

            const item: db.CertificateAttempt = {
                _id: cerattID.toString(),
                _created_at: now,
                _updated_at: now,
                started_at: now,
                ends_at: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
                student: {
                    ref: params.input.student_id,
                },
                observer: {
                    ref: params.input.observer_id,
                },
                approver: {
                    ref: params.input.approver_id,
                },
                name: template.db.name,
                requirements: Array.from(reqIDs.values()).map(x => {
                    return {
                        ref: x,
                    }
                })
            }
            await ctx.svc.instance().db.certAttempts.insertOne(item)

            // allow user to read their own certattempt
            const permReq: buslive.GivePermission_Request = {
                userId: item.student.ref,
                actionRegex: 'read',
                resourceRegex: `^(${item._id})$`
            }
            await ctx.svc.instance().nc.request(`${bus_topics.auth.live.give_permission}`,
                buslive.GivePermission_Request.encode(permReq).finish())

            return (await ctx.svc.instance().readCertAttempt(cerattID.toString())).graphql()
        },
        award: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.Cert>> => {
            const certID = new ids.ID(wkids.wellknown.certs)
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'award', certID.toString())
            const now = new Date()
            const attempt = await ctx.svc.instance().readCertAttempt(params.id)
            if (Date.parse(attempt.db.ends_at) < now.valueOf()) {
                throw new Error('can not modify - certificate attempt already ended')
            }

            const cert: db.Certificate = {
                _id: certID.toString(),
                _created_at: now.toISOString(),
                _updated_at: now.toISOString(),
                name: attempt.db.name,
                student: {
                    ref: attempt.db.student.ref
                },
                awarded: {
                    at: new Date().toISOString(),
                    by: {
                        ref: ctx.svc.instance().gwctx.user.id
                    }
                }
            }
            await ctx.svc.instance().db.certs.insertOne(cert)
            await ctx.svc.instance().db.certAttempts.deleteOne({ _id: params.id })
            for (const req of attempt.db.requirements) {
                await ctx.svc.instance().db.requirements.deleteOne({ _id: req.ref })
            }
            return (await ctx.svc.instance().readCert(certID.toString())).graphql()
        }
    },
    CertTemplateMutation: {
        create: async (_partial, params, ctx): Promise<ut.DeepPartial<gql.CertTemplate>> => {
            const id = new ids.ID(wkids.wellknown.certTemplate)
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'create', id.toString())

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
        delete: async (_partial, params, ctx): Promise<boolean> => {
            await ctx.svc.instance().authHelper.mustAccess(ctx.svc.instance().gwctx.user.id, 'delete', params.id!)
            await ctx.svc.instance().db.certTemplates.deleteOne({ _id: params.id! })
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
                certs: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.certs),
                certAttempts: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.certAttempts),
                certTemplates: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.certTemplates),
                requirements: mongoClient.db(db.DATABASE.db).collection(db.DATABASE.collections.requirementAttempt),
            }, natsConn, requestContext))
        }
    }
})
