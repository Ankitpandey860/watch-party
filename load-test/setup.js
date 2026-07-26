import axios from "axios";
import fs from "fs/promises";

const BASE_URL = "http://localhost:4000/api";
const ROOM_COUNT = 100;

const rooms = [];

for (let i = 0; i < ROOM_COUNT; i++) {
    const { data } = await axios.post(`${BASE_URL}/rooms`, {
        username: `Host-${i}`
    });

    rooms.push(data);

    console.log(
        `${i + 1}/${ROOM_COUNT}`,
        data.roomId
    );
}

await fs.writeFile(
    "./rooms.json",
    JSON.stringify(rooms, null, 2)
);

console.log("Done.");