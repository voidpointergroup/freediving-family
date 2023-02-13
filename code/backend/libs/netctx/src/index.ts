export const GATEWAY_REQUEST_CONTEXT_HEADER = 'x-request-context'

export interface GatewayRequestContext {
    user: {
        id: string
    }
}
