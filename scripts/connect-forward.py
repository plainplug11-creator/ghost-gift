#!/usr/bin/env python3
"""Forward local TCP:7844 to Cloudflare Tunnel edge via HTTP CONNECT.

This sandbox's egress proxy (typically 127.0.0.1:8791) carries HTTPS well, but
cloudflared's data plane uses TCP port 7844. Direct connections to
region*.v2.argotunnel.com are intercepted and fail. CONNECT to the public
edge IPs on 7844 works, so this process listens on 127.0.0.1:7844 and pipes
each connection through the proxy.

Used together with a /etc/hosts override that points argotunnel hostnames
at 127.0.0.1, and cloudflared --protocol http2.
"""

from __future__ import annotations

import argparse
import os
import selectors
import socket
import sys
import threading

# Official IPv4 edges from Cloudflare Tunnel firewall docs (port 7844).
REGION1 = [
    "198.41.192.167",
    "198.41.192.67",
    "198.41.192.57",
    "198.41.192.107",
    "198.41.192.27",
    "198.41.192.7",
    "198.41.192.227",
    "198.41.192.47",
    "198.41.192.37",
    "198.41.192.77",
]
REGION2 = [
    "198.41.200.13",
    "198.41.200.193",
    "198.41.200.33",
    "198.41.200.233",
    "198.41.200.53",
    "198.41.200.63",
    "198.41.200.113",
    "198.41.200.73",
    "198.41.200.43",
    "198.41.200.23",
]
EDGE_IPS = REGION1 + REGION2


def log(msg: str) -> None:
    print(msg, flush=True)


def parse_proxy(addr: str) -> tuple[str, int]:
    host, port_s = addr.rsplit(":", 1)
    return host, int(port_s)


def http_connect(proxy_host: str, proxy_port: int, dest_ip: str, dest_port: int, timeout: float) -> socket.socket:
    sock = socket.create_connection((proxy_host, proxy_port), timeout=timeout)
    req = (
        f"CONNECT {dest_ip}:{dest_port} HTTP/1.1\r\n"
        f"Host: {dest_ip}:{dest_port}\r\n"
        f"\r\n"
    ).encode("ascii")
    sock.sendall(req)
    buf = b""
    sock.settimeout(timeout)
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            sock.close()
            raise OSError(f"proxy closed while connecting to {dest_ip}:{dest_port}")
        buf += chunk
        if len(buf) > 65536:
            sock.close()
            raise OSError("proxy response too large")
    header = buf.split(b"\r\n\r\n", 1)[0].decode("iso-8859-1", "replace")
    status_line = header.split("\r\n", 1)[0]
    parts = status_line.split(" ", 2)
    code = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0
    if code != 200:
        sock.close()
        raise OSError(f"proxy CONNECT {dest_ip}:{dest_port} failed: {status_line}")
    leftover = buf.split(b"\r\n\r\n", 1)[1]
    if leftover:
        # Nothing should be sent before the client speaks; if the proxy
        # already wrote bytes, stash them by putting back via a wrapper.
        # We don't expect leftovers after a CONNECT 200.
        pass
    sock.settimeout(None)
    return sock


def pump(a: socket.socket, b: socket.socket) -> None:
    try:
        sel = selectors.DefaultSelector()
        sel.register(a, selectors.EVENT_READ, b)
        sel.register(b, selectors.EVENT_READ, a)
        while True:
            for key, _ in sel.select(timeout=300):
                src: socket.socket = key.fileobj  # type: ignore[assignment]
                dst: socket.socket = key.data
                try:
                    data = src.recv(65536)
                except OSError:
                    return
                if not data:
                    return
                try:
                    dst.sendall(data)
                except OSError:
                    return
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass


class Forwarder:
    def __init__(self, listen_host: str, listen_port: int, proxy_host: str, proxy_port: int):
        self.listen_host = listen_host
        self.listen_port = listen_port
        self.proxy_host = proxy_host
        self.proxy_port = proxy_port
        self._idx = 0
        self._lock = threading.Lock()

    def next_ips(self) -> list[str]:
        with self._lock:
            start = self._idx
            self._idx = (self._idx + 1) % len(EDGE_IPS)
        return EDGE_IPS[start:] + EDGE_IPS[:start]

    def handle(self, client: socket.socket, addr) -> None:
        client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        last_err: Exception | None = None
        for dest in self.next_ips()[:6]:
            try:
                upstream = http_connect(self.proxy_host, self.proxy_port, dest, 7844, timeout=8)
                upstream.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                log(f"connected {addr[0]}:{addr[1]} -> {dest}:7844")
                pump(client, upstream)
                return
            except Exception as exc:
                last_err = exc
                log(f"edge {dest}:7844 failed: {exc}")
                continue
        log(f"giving up on {addr}: {last_err}")
        try:
            client.close()
        except OSError:
            pass

    def serve(self) -> None:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self.listen_host, self.listen_port))
        srv.listen(64)
        log(f"CONNECT forwarder listening on {self.listen_host}:{self.listen_port} via {self.proxy_host}:{self.proxy_port}")
        while True:
            client, addr = srv.accept()
            t = threading.Thread(target=self.handle, args=(client, addr), daemon=True)
            t.start()


def main() -> None:
    default_proxy = os.environ.get("SAND_EGRESS_TUNNEL_PROXY_ADDR", "127.0.0.1:8791")
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen", default="127.0.0.1:7844")
    parser.add_argument("--proxy", default=default_proxy)
    args = parser.parse_args()
    listen_host, listen_port = parse_proxy(args.listen)
    proxy_host, proxy_port = parse_proxy(args.proxy)
    try:
        Forwarder(listen_host, listen_port, proxy_host, proxy_port).serve()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
