# Just enough of the `websockets` API for the robot's real bridge code to run unmodified. Records
# every frame each bridge sends and receives so a test can compare them.
import asyncio
import base64
import hashlib
import inspect
import struct
import types
import urllib.parse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
CONNECTIONS = {}
SENT = {}
RECEIVED = {}


class ConnectionClosed(Exception):
    pass


exceptions = types.SimpleNamespace(ConnectionClosed=ConnectionClosed)


class WebSocketServerProtocol:
    def __init__(self, reader, writer, port, path):
        self.reader = reader
        self.writer = writer
        self.port = port
        self.path = path
        self.remote_address = writer.get_extra_info("peername")
        self.closed = False
        self._lock = asyncio.Lock()

    async def _write_frame(self, opcode, payload):
        head = bytes([0x80 | opcode])
        size = len(payload)
        if size < 126:
            head += bytes([size])
        elif size < 65536:
            head += bytes([126]) + struct.pack(">H", size)
        else:
            head += bytes([127]) + struct.pack(">Q", size)
        async with self._lock:
            self.writer.write(head + payload)
            await self.writer.drain()

    async def send(self, text):
        if self.closed:
            raise ConnectionClosed()
        SENT.setdefault(self.port, []).append(text)
        try:
            await self._write_frame(0x1, text.encode("utf-8"))
        except (ConnectionError, RuntimeError) as err:
            self.closed = True
            raise ConnectionClosed() from err

    async def _read_frame(self):
        first = await self.reader.readexactly(2)
        opcode = first[0] & 0x0F
        size = first[1] & 0x7F
        if size == 126:
            size = struct.unpack(">H", await self.reader.readexactly(2))[0]
        elif size == 127:
            size = struct.unpack(">Q", await self.reader.readexactly(8))[0]
        mask = await self.reader.readexactly(4) if first[1] & 0x80 else None
        data = await self.reader.readexactly(size)
        if mask:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        return opcode, data

    def __aiter__(self):
        return self

    async def __anext__(self):
        while True:
            try:
                opcode, data = await self._read_frame()
            except (asyncio.IncompleteReadError, ConnectionError) as err:
                self.closed = True
                raise StopAsyncIteration from err
            if opcode == 0x9:
                await self._write_frame(0xA, data)
            elif opcode == 0x8:
                self.closed = True
                try:
                    await self._write_frame(0x8, data)
                except ConnectionError:
                    pass
                raise StopAsyncIteration
            elif opcode in (0x1, 0x2):
                text = data.decode("utf-8", "replace")
                RECEIVED.setdefault(self.port, []).append(text)
                return text


class _Server:
    def __init__(self, handler, host, port):
        self.handler = handler
        self.host = host
        self.port = port
        self.server = None

    async def _on_connection(self, reader, writer):
        request = await reader.readuntil(b"\r\n\r\n")
        lines = request.decode("latin-1").split("\r\n")
        path = urllib.parse.urlsplit(lines[0].split(" ")[1]).path
        headers = {
            line.split(":", 1)[0].strip().lower(): line.split(":", 1)[1].strip()
            for line in lines[1:]
            if ":" in line
        }
        accept = base64.b64encode(
            hashlib.sha1((headers["sec-websocket-key"] + GUID).encode()).digest()
        ).decode()
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        await writer.drain()
        ws = WebSocketServerProtocol(reader, writer, self.port, path)
        CONNECTIONS[self.port] = CONNECTIONS.get(self.port, 0) + 1
        try:
            if len(inspect.signature(self.handler).parameters) == 2:
                await self.handler(ws, path)
            else:
                await self.handler(ws)
        except Exception as err:
            print(f"[shim] handler on {self.port} ended: {err!r}", flush=True)
        finally:
            CONNECTIONS[self.port] -= 1
            ws.closed = True
            writer.close()

    async def _start(self):
        self.server = await asyncio.start_server(
            self._on_connection, self.host, self.port, limit=2**24
        )
        return self.server

    def __await__(self):
        return self._start().__await__()

    async def __aenter__(self):
        return await self._start()

    async def __aexit__(self, *_):
        self.server.close()


def serve(handler, host, port, **_options):
    return _Server(handler, host, port)
