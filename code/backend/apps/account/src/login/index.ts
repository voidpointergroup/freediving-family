import * as express from 'express'
import * as cf from 'cross-fetch'
import * as yaml from 'yaml'
import * as bp from 'body-parser'

process.on('SIGINT', function() {
    process.exit()
})

export interface LoginResponse {
    access_token: string
    refresh_token: string
    id_token: string
    expires_in: number
    refresh_expires_in: number
}

const config = {
    sysconf: yaml.parse(process.env['APP_SYSCONF']!),
    port: 8080
}

const app = express.default()
const jsonBodyParser = bp.json()

app.get('/login', async (req, res) => {
    const auth = req.headers.authorization
    if (!auth) {
        return res.status(401).json({})
    }
    const basicAuth = Buffer.from(auth.replace('Basic ', ''), 'base64')
    console.info(basicAuth.toString())
    const usernameAndPass = basicAuth.toString().split(':')
    if (usernameAndPass.length != 2) {
        return res.status(401).json({})
    }

    const formData = new URLSearchParams()
    formData.append('grant_type', 'password')
    formData.append('scope', 'openid')
    formData.append('client_id', config.sysconf.auth.keycloak.realm)
    formData.append('client_secret', config.sysconf.auth.keycloak.client_secret)
    formData.append('username', usernameAndPass[0]!)
    formData.append('password', usernameAndPass[1]!)
    const loginResp = await cf.fetch(`${config.sysconf.auth.keycloak.endpoint}/realms/mcamp/protocol/openid-connect/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
    })
    if (loginResp.status !== 200) {
        return res.status(401).json({})
    }
    const retV = await loginResp.json() as LoginResponse
    return res.status(200).json({
        access_token: retV.access_token,
        refresh_token: retV.refresh_token,
        id_token: retV.id_token,
        expires_in: retV.expires_in,
        refresh_expires_in: retV.refresh_expires_in,
    } as LoginResponse)
})

app.get('/login/refresh', jsonBodyParser, async (req, res) => {
    const refresh_token = req.body.refresh_token

    const formData = new URLSearchParams()
    formData.append('grant_type', 'refresh_token')
    formData.append('scope', 'openid')
    formData.append('client_id', config.sysconf.auth.keycloak.realm)
    formData.append('client_secret', config.sysconf.auth.keycloak.client_secret)
    formData.append('refresh_token', refresh_token)
    const loginResp = await cf.fetch(`${config.sysconf.auth.keycloak.endpoint}/realms/mcamp/protocol/openid-connect/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
    })
    if (loginResp.status !== 200) {
        return res.status(401).json({})
    }

    const retV = await loginResp.json() as LoginResponse
    return res.status(200).json({
        access_token: retV.access_token,
        refresh_token: retV.refresh_token,
        id_token: retV.id_token,
        expires_in: retV.expires_in,
        refresh_expires_in: retV.refresh_expires_in,
    } as LoginResponse)
})

app.listen(config.port, () => {
    console.info(`listening on port ${config.port}`)
})
