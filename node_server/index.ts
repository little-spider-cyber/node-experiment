import { createServer, Socket } from "net";

// A promise-based API for TCP sockets.
type TCPConn = {
  // the JS socket object
  socket: Socket;
  // from the 'error' event
  err: null | Error;
  // EOF, from the 'end' event
  ended: boolean;
  // the callbacks of the promise of the current read
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

// A dynamic-sized buffer
type DynBuf = {
  data: Buffer;
  length: number;
};

function soInit(sock: Socket): TCPConn {
  const conn: TCPConn = {
    socket: sock,
    reader: null,
    err: null,
    ended: false,
  };
  sock.on("data", (data) => {
    console.log("🚀 ~ sock.on ~ data:", data.toString());
    conn.socket.pause();
    conn.reader?.resolve(data);
    conn.reader = null;
  });
  sock.on("error", (err) => {
    conn.err = err;
    conn.reader?.reject(err);
    conn.reader = null;
  });
  sock.on("end", () => {
    conn.ended = true;
    conn.reader?.resolve(Buffer.from("EOF"));
    conn.reader = null;
  });
  return conn;
}

function soRead(conn: TCPConn): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // if (conn.reader !== null) {
    //   reject(new Error("Already reading"));
    // }
    if (conn.err !== null) {
      reject(conn.err);
      return;
    }
    if (conn.ended) {
      resolve(Buffer.from("EOF"));
    }
    conn.reader = {
      resolve,
      reject,
    };
    conn.socket.resume();
  });
}

function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (conn.err !== null) {
      reject(conn.err);
      return;
    }
    conn.socket.write(data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function serveClient(socket: Socket) {
  const conn = soInit(socket);
  const buf: DynBuf = {
    data: Buffer.alloc(0),
    length: 0,
  };
  while (true) {
    const msg = cutMessage(buf);
    if (!msg) {
      const data = await soRead(conn);
      bufPush(buf, data);
      if (data.length === 0) {
        console.log("connection ended");
        return;
      }
      continue;
    }
    // process the message and send the response
    if (msg.equals(Buffer.from("quit\n"))) {
      await soWrite(conn, Buffer.from("Bye.\n"));
      socket.destroy();
      return;
    } else {
      const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
      await soWrite(conn, reply);
    }
  }
}

function cutMessage(buf: DynBuf): null | Buffer {
  // messages are separated by '\n'
  const idx = buf.data.subarray(0, buf.length).indexOf("\n");
  if (idx < 0) {
    return null; // not complete
  }
  // make a copy of the message and move the remaining data to the front
  const msg = Buffer.from(buf.data.subarray(0, idx + 1));
  bufPop(buf, idx + 1);
  return msg;
}
// remove data from the front
function bufPop(buf: DynBuf, len: number): void {
  buf.data.copyWithin(0, len, buf.length);
  buf.length -= len;
}

async function newConn(socket: Socket) {
  console.log(socket.remoteAddress, socket.remotePort);
  try {
    await serveClient(socket);
  } catch (err) {
    console.error(err);
  } finally {
    socket.destroy();
  }
}

const server = createServer({
  pauseOnConnect: true, // required by `TCPConn`
});

server.on("connection", newConn);

server.listen(1234, () => {
  console.log("server listening on port 1234");
});

// append data to DynBuf
function bufPush(buf: DynBuf, data: Buffer): void {
  const newLen = buf.length + data.length;
  if (buf.data.length < newLen) {
    // grow the capacity by the power of two
    let cap = Math.max(buf.data.length, 32);
    while (cap < newLen) {
      cap *= 2;
    }
    const grown = Buffer.alloc(cap);
    buf.data.copy(grown, 0, 0);
    buf.data = grown;
  }
  data.copy(buf.data, buf.length, 0);
  buf.length = newLen;
}
