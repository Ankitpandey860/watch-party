import axios from "axios";
import { io } from "socket.io-client";
import { randomUUID } from "crypto";
import fs from "fs";

const BASE_URL = "http://localhost:4000/api";
const SOCKET_URL = "http://localhost:4000";

const rooms = JSON.parse(
    fs.readFileSync("./rooms.json", "utf8")
);

function randomName(prefix = "User") {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomRoom() {
    return rooms[
        Math.floor(Math.random() * rooms.length)
    ];
}

async function joinRandomRoom() {

    const room = randomRoom();

    const username = randomName();

    const { data } = await axios.post(
        `${BASE_URL}/rooms/${room.roomId}/join`,
        {
            username
        }
    );

    return {
        roomId: data.roomId,
        userId: data.userId,
        username: data.username,
        role: data.role
    };
}

async function connect(user) {

    return new Promise((resolve, reject) => {

        const socket = io(SOCKET_URL, {
            transports: ["websocket"],
            timeout: 10000
        });

        socket.on("connect", () => {

            socket.emit("join_room", {
                roomId: user.roomId,
                userId: user.userId,
                username: user.username
            });

        });

        socket.on("room_state", state => {

            user.role = state.you.role;

            resolve({
                socket,
                state
            });

        });

        socket.on("connect_error", reject);

        socket.on("error_event", reject);

    });

}

async function simulateUser(socket, user) {

    await sleep(Math.random() * 2000);

    socket.emit("send_message", {
        message: `Hello from ${user.username}`
    });

    await sleep(Math.random() * 3000);

    if (user.role === "host") {

        socket.emit("play");

        await sleep(1000);

        socket.emit("time_sync", {
            time: 25
        });

        await sleep(1000);

        socket.emit("seek", {
            time: 35
        });

        await sleep(1000);

        socket.emit("pause");

    }

    await sleep(5000);

}

export async function runScenario(context, events) {

    let socket;

    try {

        const user = await joinRandomRoom();

        const result = await connect(user);

        socket = result.socket;

        await simulateUser(socket, user);

        socket.emit("leave_room");

        socket.disconnect();

    }

    catch (err) {

        console.error(err);

        if (socket) {

            socket.disconnect();

        }

        throw err;

    }

}