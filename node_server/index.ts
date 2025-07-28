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
class HTTPError extends Error {
  code;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
// a parsed HTTP request header
type HTTPReq = {
  method: string;
  uri: Buffer;
  version: string;
  headers: Buffer[];
};

// an HTTP response
type HTTPRes = {
  code: number;
  headers: Buffer[];
  body: BodyReader;
};

// an interface for reading/writing data from/to the HTTP body.
type BodyReader = {
  // the "Content-Length", -1 if unknown.
  length: number;
  // read data. returns an empty buffer after EOF.
  read: () => Promise<Buffer>;
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
    const msg: HTTPReq | null = cutMessage(buf);
    if (!msg) {
      const data = await soRead(conn);
      bufPush(buf, data);
      if (data.length === 0 && buf.length === 0) {
        console.log("connection ended");
        return;
      }
      if (data.length === 0) {
        throw new HTTPError(400, "Unexpected EOF");
      }
      continue;
    }
    const reqBody: BodyReader = readerFromReq(conn, buf, msg);
    const res: HTTPRes = await handleReq(msg, reqBody);
    await writeHTTPResp(conn, res);
    // close the connection for HTTP/1.0
    if (msg.version === "1.0") {
      return;
    }
    // make sure that the request body is consumed completely
    while ((await reqBody.read()).length > 0) {
      /* empty */
    }
    // // process the message and send the response
    // if (msg.equals(Buffer.from("quit\n"))) {
    //   await soWrite(conn, Buffer.from("Bye.\n"));
    //   socket.destroy();
    //   return;
    // } else {
    //   const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
    //   await soWrite(conn, reply);
    // }
  }
}

const splitter = "\r\n\r\n";
const kMaxHeaderLen = 1024 * 8;
function cutMessage(buf: DynBuf): null | HTTPReq {
  // messages are separated by '\n'
  const idx = buf.data.subarray(0, buf.length).indexOf(splitter);
  if (idx < 0) {
    if (buf.length > kMaxHeaderLen) {
      throw new HTTPError(413, "Request Header Fields Too Large");
    }
    return null; // not complete
  }
  // make a copy of the message and move the remaining data to the front
  const msg = parseHTTPReq(buf.data.subarray(0, idx + 4));
  bufPop(buf, idx + 1);
  return msg;
}

function parseHTTPReq(buf: Buffer): HTTPReq {
  const lines = splitLines(buf);
  const firstLine = lines[0];
  const [method, uri, version] = firstLine?.toString().split(" ") ?? [];
  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? Buffer.from("");
    if (!validateHeader(line)) {
      throw new HTTPError(400, "Invalid header, line: " + line.toString());
    }
    headers.push(line);
  }
  if (!method || !uri || !version) {
    throw new HTTPError(
      400,
      "Invalid request, method: " +
        method +
        ", uri: " +
        uri +
        ", version: " +
        version
    );
  }
  return {
    method,
    uri: Buffer.from(uri),
    version,
    headers,
  };
}

function splitLines(buf: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;

  // Scan through buffer looking for \r\n line endings
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
      // \r\n
      // Extract line from start to current position
      lines.push(buf.subarray(start, i));
      // Skip over \r\n
      i++;
      // Next line starts after \r\n
      start = i + 1;
    }
  }
  return lines;
}

function validateHeader(header: Buffer): boolean {
  const [key, value] = header.toString().split(": ");
  if (key && value) {
    return true;
  }
  return false;
}
// remove data from the front
function bufPop(buf: DynBuf, len: number): void {
  buf.data.copyWithin(0, len, buf.length);
  buf.length -= len;
}

function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq): BodyReader {
  let bodyLen = -1;
  const contentLen = fieldGet(req.headers, "Content-Length");
  if (contentLen) {
    bodyLen = parseInt(contentLen.toString("latin1"));
    if (isNaN(bodyLen)) {
      throw new HTTPError(400, "bad Content-Length.");
    }
  }
  const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
  const chunked =
    fieldGet(req.headers, "Transfer-Encoding")?.toString() === "chunked" ||
    false;
  if (!bodyAllowed && (bodyLen > 0 || chunked)) {
    throw new HTTPError(400, "HTTP body not allowed.");
  }
  if (!bodyAllowed) {
    bodyLen = 0;
  }
  if (bodyLen >= 0) {
    return readerFromConnLength(conn, buf, bodyLen);
  } else if (chunked) {
    throw new HTTPError(501, "TODO for chunked encoding");
  } else {
    throw new HTTPError(501, "TODO for EOF");
  }
}

function readerFromConnLength(
  conn: TCPConn,
  buf: DynBuf,
  remain: number
): BodyReader {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      if (remain <= 0) {
        return Buffer.from(""); // EOF
      }
      if (buf.length <= 0) {
        const data = await soRead(conn);
        bufPush(buf, data);
        if (data.length === 0) {
          throw new HTTPError(400, "Unexpected EOF in request body");
        }
      }

      // Consume what we need and put the rest back in buffer
      const consume = Math.min(buf.length, remain);
      const result = buf.data.subarray(0, consume);
      remain -= consume;
      bufPop(buf, consume);
      return Buffer.from(result);
    },
  };
}
function fieldGet(headers: Buffer[], field: string): Buffer | null {
  for (const header of headers) {
    const [key, value] = header.toString().split(": ");
    if (key === field) {
      return Buffer.from(value ?? "");
    }
  }
  return null;
}

async function handleReq(req: HTTPReq, reqBody: BodyReader): Promise<HTTPRes> {
  let resBody: BodyReader;
  switch (req.uri.toString()) {
    case "/echo":
      resBody = reqBody;
      break;
    default:
      resBody = readerFromMemory(Buffer.from("hello world.\n"));
      break;
  }
  return {
    code: 200,
    headers: [Buffer.from("Server: my_first_http_server")],
    body: resBody,
  };
}

async function writeHTTPResp(conn: TCPConn, res: HTTPRes): Promise<void> {
  if (res.body.length < 0) {
    throw new HTTPError(501, "TODO for chunked encoding");
  }
  res.headers.push(Buffer.from("Content-Length: " + res.body.length));
  const headers = await encodeHTTPRespHeaders(res);
  await soWrite(conn, headers);
  while (true) {
    const data = await res.body.read();
    if (data.length === 0) {
      break;
    }
    await soWrite(conn, data);
  }
}

async function encodeHTTPRespHeaders(res: HTTPRes): Promise<Buffer> {
  return Buffer.from(
    "HTTP/1.1 200 OK\r\n" + res.headers.join("\r\n") + "\r\n\r\n"
  );
}

function readerFromMemory(data: Buffer): BodyReader {
  let isDone = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (isDone) {
        return Buffer.from("");
      }
      isDone = true;
      return data;
    },
  };
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
