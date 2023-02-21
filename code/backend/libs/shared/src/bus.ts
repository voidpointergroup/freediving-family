import * as nats from 'nats'
import * as bus from '../../bus/ts/__generated__/proto/bus/live'
import * as bus_topics from '../../bus/topics.json'

export class Auth {
    constructor(private nats: nats.NatsConnection) {
    }

    public async mayAccess(userID: string, action: string, resource: string): Promise<bus.Authorize_Response> {
        const req = bus.Authorize_Request.encode({
            userId: userID,
            action: action,
            resourceId: resource
        }).finish()
        const response = await this.nats.request(bus_topics.auth.live.authorize, req)
        const responseT = bus.Authorize_Response.decode(response.data)
        if (!responseT.permitted) {
            console.error(responseT.reason)
        }
        return responseT
    }

    public async mustAccess(userID: string, action: string, resource: string): Promise<void> {
        const res = await this.mayAccess(userID, action, resource)
        if (!res.permitted) {
            throw new Error(res.reason)
        }
    }
}
