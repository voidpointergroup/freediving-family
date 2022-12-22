import * as apollo_server from '@apollo/server'
import * as apollo_standalone from '@apollo/server/standalone'
import * as apollo_subgraph from '@apollo/subgraph'
import * as gql from './__generated__/resolvers-types'
import * as gqltag from 'graphql-tag'
import * as fs from 'fs'
import * as mongo from 'mongodb'
import * as db from './db'

const schemaString = fs.readFileSync('./res/contract/schema.graphql', { encoding: 'utf-8' })
const typeDefs = gqltag.gql`${schemaString}`

const EIDIsNull = 'ID is not defined'
const EDocumentNotFound = 'document not found'

const resolvers: gql.gqlResolvers<Service> = {
    Query: {
        account: async (_a, params, _svc): Promise<Partial<gql.gqlAccount>> => {
            return {
                id: params.id,
            }
        },
    },
    Mutation: {
        create_account: async (_, params, svc): Promise<Partial<gql.gqlAccount>> => {
            const doc = {
                _id: params.in.name,
                name: params.in.name,
            }
            await svc.accounts.insertOne(doc)
            return {
                id: doc._id,
            }
        },
        account: async (_, params, _svc): Promise<Partial<gql.gqlMutationAccount>> => {
            return {
                id: params.id,
            }
        }
    },
    Account: {
        name: async (partial, __, svc): Promise<string> => {
            if (!partial.id) {
                throw EIDIsNull
            }

            const doc = await svc.accounts.findOne({
                _id: partial.id
            })
            if (!doc) {
                throw EDocumentNotFound
            }
            return doc.name
        }
    },
    MutationAccount: {
        update: async (partial, params, svc): Promise<Partial<gql.gqlAccount>> => {
            if (!partial.id) {
                throw EIDIsNull
            }

            const doc = await svc.accounts.findOne({
                _id: partial.id
            })
            if (!doc) {
                throw EDocumentNotFound
            }

            if (params.in.name) {
                doc.name = params.in.name
            }

            await svc.accounts.replaceOne({
                _id: partial.id
            }, doc)
            return {
                id: partial.id,
            }
        }
    }
}

export interface Service {
    accounts: mongo.Collection<db.dbAccount>,
}

const mongoUrl = 'mongodb://localhost:27017'
const mongoClient = new mongo.MongoClient(mongoUrl, {
    directConnection: true
})
const svc: Service = {
    accounts: mongoClient.db('ff-account').collection('accounts')
}

const server = new apollo_server.ApolloServer<Service>({
    schema: apollo_subgraph.buildSubgraphSchema({ typeDefs, resolvers }),
})

await apollo_standalone.startStandaloneServer(server, {
    listen: {
        port: 8080
    },
    context: async () => {
        return svc
    }
})
