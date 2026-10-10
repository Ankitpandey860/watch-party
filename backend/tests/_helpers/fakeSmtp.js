// A tiny real SMTP server (plain, no auth) that records messages. Lets tests drive the actual
// nodemailer SMTP transport end-to-end with no external service.
import net from "node:net";

export async function startFakeSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buf = "";
    let inData = false;
    let current = { from: "", to: [], raw: "" };
    socket.write("220 fake-smtp ready\r\n");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.raw = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          messages.push(current);
          current = { from: "", to: [], raw: "" };
          socket.write("250 queued\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") socket.write("250-fake-smtp\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL") { current.from = line; socket.write("250 ok\r\n"); }
        else if (cmd === "RCPT") { current.to.push(line); socket.write("250 ok\r\n"); }
        else if (cmd === "DATA") { inData = true; socket.write("354 go\r\n"); }
        else if (cmd === "QUIT") { socket.write("221 bye\r\n"); socket.end(); return; }
        else socket.write("250 ok\r\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: server.address().port,
    messages,
    close: () => new Promise((r) => server.close(r)),
  };
}
