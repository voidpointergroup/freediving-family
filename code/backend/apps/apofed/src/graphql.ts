import { ApolloServer } from 'apollo-server'
import { GraphQLError } from "graphql"
import { ApolloGateway, IntrospectAndCompose, GraphQLDataSourceProcessOptions, RemoteGraphQLDataSource } from '@apollo/gateway'
import { GraphQLDataSourceRequestKind } from '@apollo/gateway/dist/datasources/types'
import * as buslive from '../../../libs/bus/ts/__generated__/proto/bus/live'
import * as bus_topics from '../../../libs/bus/topics.json'
import * as base64 from 'js-base64'
import * as nats from 'nats'
import * as yaml from 'yaml'
import * as ulid from 'ulid'
import * as netctx from '../../../libs/shared/src/gateway'

process.on('SIGINT', function () {
    process.exit()
})

function getEnv(name: string): string {
    if (process.env[name] === undefined) {
        throw new Error(`env var not set ${name}`)
    }
    return process.env[name]!
}

const config = {
    port: getEnv('APP_PORT'),
    services: getEnv('APP_SERVICES').split(','),
    sysconf: yaml.parse(process.env['APP_SYSCONF']!),
}

class Service {
    constructor(private nc: nats.NatsConnection) { }

    public async verify(jwt: string): Promise<buslive.JwtVerification_Response_Details> {
        const resp = await this.nc.request(bus_topics.auth.live.verify, buslive.JwtVerification_Request.encode({
            jwt,
        }).finish(), {
            timeout: 2000,
        })
        const respD = buslive.JwtVerification_Response.decode(resp.data)
        if (!respD.ok || !respD.details) {
            throw new Error('jwt could not be verified')
        }
        return respD.details
    }
}
const svc = new Service(await nats.connect({
    servers: config.sysconf.bus.nats.url,
}))

class CustomDataSource extends RemoteGraphQLDataSource {
    override async willSendRequest(options: GraphQLDataSourceProcessOptions<any>,
    ): Promise<void> {
        switch (options.kind) {
            case GraphQLDataSourceRequestKind.HEALTH_CHECK:
                break;
            case GraphQLDataSourceRequestKind.LOADING_SCHEMA:
                break;
            case GraphQLDataSourceRequestKind.INCOMING_OPERATION:
                const authHeader = options.incomingRequestContext.request.http!.headers.get("Authorization");
                if (!authHeader) {
                    throw 'did not specify JWT'
                }
                const token = (authHeader as string).substring('Bearer '.length);
                const verJwt = await svc.verify(token)

                const context: netctx.GatewayRequestContext = {
                    id: ulid.ulid().toString().toLowerCase(),
                    user: {
                        id: verJwt.id
                    }
                }

                console.info(JSON.stringify(context))
                // options.request.http!.headers.set('Authorization', authHeader)
                const forwardContext = base64.btoa(JSON.stringify(context))
                options.request.http!.headers.set('x-request-context', forwardContext)

                break;
            default:
                throw 'unknown kind'
        }
    }
}

const gateway = new ApolloGateway({
    buildService({ url }): CustomDataSource {
        return new CustomDataSource({ url: url! })
    },
    serviceHealthCheck: true,
    supergraphSdl: new IntrospectAndCompose({
        pollIntervalInMs: 10000, // all 10 seconds
        subgraphHealthCheck: true, // fail on invalid sub graph
        logger: console,
        subgraphs: config.services.map(s => {
            return {
                name: s,
                url: s,
            }
        }),
    }),
})

const server = new ApolloServer({
    gateway,
    context: (e) => {
        return {
            ...e,
        }
    },
    formatError: (e: GraphQLError) => {
        console.error(JSON.stringify(e))
        return {
            message: e.message,
            // locations: e.locations,
            // extensions: undefined
        }
    },
    plugins: [
        {
            async requestDidStart() {
                return {
                    async willSendResponse(context: any) {
                        const headers = {
                            // default recommended security headers for public APIs
                            'x-frame-options': 'deny',
                            'x-content-type-options': 'nosniff',
                            'x-xss-protection': '1; mode=block',
                            'cache-control': 'no-cache',
                            'content-security-policy': "default-src 'none'",
                            'strict-transport-security': 'max-age=31536000; includeSubdomains',
                        }
                        for (const [k, v] of Object.entries(headers)) {
                            context.response.http.headers.append(k, v)
                        }
                    }
                }
            }
        },
    ],
})

server.listen({ port: config.port })
