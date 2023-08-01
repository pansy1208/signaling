const Koa = require("koa")
const cors = require("@koa/cors")
const bodyParser = require("koa-bodyparser")
const WebSocket = require("ws")
const {v4: uuidV4} = require("uuid")

const app = new Koa()

app.use(cors())
app.use(bodyParser())

const rooms = {}
const clients = {}

const wss = new WebSocket.Server({port: 8000})

wss.on("connection", (socket, req) => {
    console.log("socket connect success")
    const {url} = req
    if (!url.startsWith('/signaling')) {
        console.log("url error")
        return wss.close()
    }

    socket.send("ping")

    socket.intervalIndex = setInterval(() => {
        socket.send("nping")
    }, 180000)

    socket.on("message", (data) => {
        let message = data.toString()
        if (message === "pong") {
            setTimeout(() => {
                socket.send("ping")
            }, 1000)
        }

        if (message !== "pong" && message !== "npong") {
            const messageObj = JSON.parse(message)
            if (messageObj.method === "joinRoom") {
                const id = uuidV4().replace(/-/g, '')
                socket.remark = {
                    userId: id,
                    roomId: messageObj.roomId
                }

                const room = rooms[messageObj.roomId]
                let user = {
                    name: messageObj.username,
                    id: id,
                    videoStatus: messageObj.videoStatus,
                    audioStatus: messageObj.audioStatus,
                    isHasAuth: messageObj.isHasAuth,
                    isShareScreen: false
                }

                if (room) {
                    room.memberList.push(user)
                } else {
                    rooms[messageObj.roomId] = {
                        startTime: +new Date(),
                        roomId: messageObj.roomId,
                        memberList: [user],
                    }
                }

                socket.send(JSON.stringify({...rooms[messageObj.roomId], method: "joinRoom", user}))
                const clientList = clients[messageObj.roomId]

                if (clientList) {
                    clients[messageObj.roomId].forEach(({client}) => {
                        client.send(JSON.stringify({user, method: "newClient"}))
                    })
                    clients[messageObj.roomId].push({
                        client: socket,
                        id: id
                    })
                } else {
                    clients[messageObj.roomId] = [{
                        client: socket,
                        id: id
                    }]
                }

            }

            if (messageObj.method === "offer" || messageObj.method === "answer" || messageObj.method === "icecandidate") {
                sendRTCMessage(messageObj)
            }

            if (messageObj.method === "videoStatus" || messageObj.method === "audioStatus") {
                changeStatus(messageObj, false)
            }

            if (messageObj.method === "shareScreen") {
                changeStatus(messageObj, true)
            }
        }

    })

    socket.on("close", (data) => {
        clearInterval(socket.intervalIndex)
        if (!socket.remark) return
        const room = rooms[socket.remark?.roomId]
        const client = clients[socket.remark.roomId]
        room.memberList.forEach((item, index) => {
            if (item.id === socket.remark.userId) {
                room.memberList.splice(index, 1)
            }
        })
        if (room.memberList.length === 0) {
            delete rooms[socket.remark.roomId]
        }

        const leaveUserIndex = client.findIndex(item => {
            return item.id === socket.remark.userId
        })
        client.splice(leaveUserIndex, 1)

        client.forEach(item => {
            item.client.send(JSON.stringify({
                method: "leave",
                id: socket.remark.userId
            }))
        })

        if (client.length === 0) {
            delete clients[socket.remark.roomId]
        }

    })
})

const sendRTCMessage = (messageObj) => {
    const targetId = messageObj.targetId
    const roomClient = clients[messageObj.roomId]
    roomClient.forEach((client) => {
        if (client.id === targetId) {
            client.client.send(JSON.stringify({
                ...messageObj,
                targetId: messageObj.userId,
                userId: messageObj.targetId
            }))
        }
    })
}

const changeStatus = (messageObj, isAll) => {
    const userId = messageObj.userId
    const roomClient = clients[messageObj.roomId]
    const memberList = rooms[messageObj.roomId].memberList
    for (let i = 0; i < memberList.length; i++) {
        if (memberList[i].id === userId) {
            memberList[i][messageObj.method] = messageObj.status
            break
        }
    }

    roomClient.forEach((client) => {
        if (client.id !== userId || isAll) {
            client.client.send(JSON.stringify({
                ...messageObj,
            }))
        }
    })
}