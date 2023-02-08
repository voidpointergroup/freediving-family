import { ApolloServer } from 'apollo-server'
import { GraphQLError } from "graphql"
import { ApolloGateway, IntrospectAndCompose, GraphQLDataSourceProcessOptions, RemoteGraphQLDataSource } from '@apollo/gateway'
import { GraphQLDataSourceRequestKind } from '@apollo/gateway/dist/datasources/types'
import * as jwt from 'jsonwebtoken'
import * as jwk from 'jwks-rsa'
import * as base64 from 'js-base64'

function getEnv(name: string): string {
    if (process.env[name] === undefined) {
        throw new Error(`env var not set ${name}`)
    }
    return process.env[name]!
}

const jwkClient = jwk.default({
    jwksUri: getEnv("APP_KEYCLOAK_REALM_URL") + "/protocol/openid-connect/certs"
});

const config = {
    port: getEnv('APP_PORT'),
    services: getEnv('APP_SERVICES').split(','),
}

interface XContext {
    user: {
        id: string,
        email: string,
        roles: string[],
    }
}

class CustomDataSource extends RemoteGraphQLDataSource {
    override async willSendRequest(options: GraphQLDataSourceProcessOptions<any>,
    ): Promise<void> {
        switch (options.kind) {
            case GraphQLDataSourceRequestKind.HEALTH_CHECK:
            case GraphQLDataSourceRequestKind.LOADING_SCHEMA:
                break;
            case GraphQLDataSourceRequestKind.INCOMING_OPERATION:
                const authHeader = options.incomingRequestContext.request.http!.headers.get("Authorization");
                if (!authHeader) {
                    throw 'did not specify JWT'
                }
                const token = (authHeader as string).substring('Bearer '.length);
                const decoded = jwt.decode(token, { complete: true });
                if (!decoded) {
                    throw 'decoded is undefined or null'
                }

                const key = await jwkClient.getSigningKey(decoded.header.kid)
                const ver = jwt.verify(token, key.getPublicKey(), {}) as jwt.JwtPayload
                if (!ver) {
                    throw 'verified jwt is of wrong type'
                }

                const context: XContext = {
                    user: {
                        id: ver["email"] as string,
                        email: ver["email"] as string,
                        roles: ['admin']
                    }
                }

                console.info(JSON.stringify(context))
                options.request.http!.headers.set('Authorization', authHeader)
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
