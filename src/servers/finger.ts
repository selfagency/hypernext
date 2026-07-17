import net from "node:net";
import type { HypernextConfig } from "../types/config.js";

export function startFingerServer(config: HypernextConfig): net.Server {
  const { port } = config.protocols.finger;

  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf-8");
      if (data.includes("\r\n") || data.length > 256) {
        handleFingerRequest(socket, data.trim(), config);
      }
    });
  });

  server.listen(port, () => {
    console.log(`Finger server listening on port ${port}`);
  });
  return server;
}

function handleFingerRequest(
  socket: net.Socket,
  _request: string,
  config: HypernextConfig
): void {
  const { author } = config;
  const lines: string[] = [];

  lines.push(`Login: ${author.name}`);
  if (author.email) {
    lines.push(`Email: ${author.email}`);
  }
  if (author.url) {
    lines.push(`URL: ${author.url}`);
  }
  if (author.bio) {
    lines.push(`Bio: ${author.bio}`);
  }

  socket.end(`${lines.join("\r\n")}\r\n`);
}
