"""
Security and behaviour tests for the local API in z30_dsp/web_server.py.

Binding to 127.0.0.1 is not an authentication boundary. Any page in any browser tab can
`fetch()` a loopback URL, and a `text/plain` POST is a CORS simple request that goes out with
no preflight - so before these checks existed, an advertisement in an unrelated tab could key
the operator's transmitter. These tests pin the three conditions that close that hole, and the
dead-man switch that bounds a keyed transmitter.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

import pytest

from z30_dsp import web_server as ws

TOKEN = "test-token-not-a-real-one"


class FakeGpioDevice:
    """Stands in for gpiozero's DigitalOutputDevice so the bridge can be tested off a Pi."""

    def __init__(self, pin: int) -> None:
        self.pin = pin
        self.value = False
        self.closed = False

    def on(self) -> None:
        self.value = True

    def off(self) -> None:
        self.value = False

    def close(self) -> None:
        self.closed = True


@pytest.fixture()
def bridge():
    b = ws.GpioBridge(allowed_pin=17)
    b._DigitalOutputDevice = FakeGpioDevice  # noqa: SLF001 - deliberate hardware stand-in
    b._import_error = None  # noqa: SLF001
    yield b
    b.shutdown()


@pytest.fixture()
def server(tmp_path, monkeypatch, bridge):
    monkeypatch.setenv("Z30_HOME", str(tmp_path))
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><html><head></head><body>z-30</body></html>", encoding="utf-8")

    sock, port = ws.bind_listening_socket(0)
    origin = f"http://127.0.0.1:{port}"

    class BoundHandler(ws.SpaRequestHandler):
        api_token = TOKEN
        allowed_origin = origin
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    BoundHandler.gpio_bridge = bridge
    httpd = ws.ThreadedHTTPServer(sock, lambda *a, **k: BoundHandler(*a, directory=str(dist), **k))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.15)
    try:
        yield origin
    finally:
        httpd.shutdown()
        httpd.server_close()


def request(origin, path, body=None, headers=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(origin + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, dict(response.headers), response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode()


def authed(extra=None):
    headers = {"X-Z30-Token": TOKEN}
    if extra:
        headers.update(extra)
    return headers


# -- authentication --------------------------------------------------------

def test_api_rejects_requests_without_a_token(server):
    """The exact shape of the cross-origin attack: a simple POST with no preflight."""
    status, _headers, body = request(
        server, "/api/gpio", {"pin": 17, "value": True}, {"Content-Type": "text/plain"}
    )
    assert status == 403
    assert "token" in json.loads(body)["error"].lower()


def test_api_rejects_a_foreign_origin_even_with_a_token(server):
    status, _headers, body = request(
        server, "/api/status", None, authed({"Origin": "https://attacker.example"})
    )
    assert status == 403
    assert "Origin" in json.loads(body)["error"]


def test_api_rejects_a_foreign_host_header(server):
    """A DNS-rebinding victim's request arrives carrying the attacker's hostname."""
    status, _headers, body = request(server, "/api/status", None, authed({"Host": "rebind.attacker.example"}))
    assert status == 403
    assert "Host" in json.loads(body)["error"]


def test_api_accepts_its_own_origin_with_a_token(server):
    status, _headers, body = request(server, "/api/status", None, authed({"Origin": server}))
    assert status == 200
    assert json.loads(body)["status"] == "ONLINE"


def test_no_wildcard_cors_header_is_ever_sent(server):
    for path, headers in (("/api/status", authed()), ("/", None)):
        _status, response_headers, _body = request(server, path, None, headers)
        assert response_headers.get("Access-Control-Allow-Origin") is None, (
            "a wildcard ACAO would let any origin read the response as well as send it"
        )


def test_index_html_carries_the_api_token(server):
    status, _headers, body = request(server, "/")
    assert status == 200
    assert "__Z30_API_TOKEN__" in body
    assert TOKEN in body


def test_static_assets_do_not_require_a_token(server):
    """The bundle is public code; requiring a token to load it would prevent the app starting."""
    status, _headers, _body = request(server, "/index.html")
    assert status == 200


# -- GPIO pin whitelisting -------------------------------------------------

def test_only_the_configured_ptt_pin_can_be_driven(server, bridge):
    status, _headers, body = request(server, "/api/gpio", {"pin": 22, "value": True}, authed())
    assert status == 400
    assert "not the configured PTT pin" in json.loads(body)["error"]
    assert 22 not in bridge._devices  # noqa: SLF001


def test_configured_pin_keys_and_unkeys(server, bridge):
    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "value": True}, authed())
    assert status == 200
    assert bridge._devices[17].value is True  # noqa: SLF001

    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "value": False}, authed())
    assert status == 200
    assert bridge._devices[17].value is False  # noqa: SLF001


# -- dead-man switch -------------------------------------------------------

def test_watchdog_releases_the_pin_when_keepalives_stop(bridge, monkeypatch):
    """
    The failure this defends against is "the browser stopped running": a crashed tab, a killed
    renderer, a sleeping machine. None of those can send a keepalive, and none of them can run
    a browser-side timeout either - which is why the release has to happen server-side.
    """
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.3)
    assert bridge.set_pin(17, True)["success"]
    assert bridge._devices[17].value is True  # noqa: SLF001

    time.sleep(0.7)
    assert bridge._devices[17].value is False, "the watchdog did not drop the PTT line"  # noqa: SLF001


def test_keepalive_holds_the_pin_up(bridge, monkeypatch):
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.4)
    assert bridge.set_pin(17, True)["success"]
    for _ in range(5):
        time.sleep(0.15)
        assert bridge.keepalive(17)["success"]
    assert bridge._devices[17].value is True  # noqa: SLF001


def test_hard_ceiling_releases_even_with_keepalives(bridge, monkeypatch):
    monkeypatch.setattr(ws, "GPIO_MAX_KEYED_SEC", 0.4)
    assert bridge.set_pin(17, True)["success"]
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        bridge.keepalive(17)
        time.sleep(0.05)
    assert bridge._devices[17].value is False, "the maximum keyed time was not enforced"  # noqa: SLF001


def test_release_all_closes_every_device(bridge):
    bridge.set_pin(17, True)
    device = bridge._devices[17]  # noqa: SLF001
    bridge.release_all()
    assert device.value is False
    assert device.closed is True


# -- rigctld relay ---------------------------------------------------------

def test_rigctl_relay_refuses_non_loopback_hosts(server):
    """Relaying anywhere would turn this into a general-purpose TCP client for the whole net."""
    status, _headers, body = request(
        server, "/api/rigctl", {"command": "f", "host": "203.0.113.5", "port": 4532}, authed()
    )
    assert status == 400
    assert "loopback" in json.loads(body)["error"].lower()


def test_rigctl_relay_reports_an_unreachable_daemon_honestly(server):
    status, _headers, body = request(
        server, "/api/rigctl", {"command": "f", "host": "127.0.0.1", "port": 45999}, authed()
    )
    assert status == 502
    payload = json.loads(body)
    assert payload["success"] is False
    assert "rigctld" in payload["error"]


# -- operator data ---------------------------------------------------------

def test_logbook_round_trips_to_disk(server, tmp_path):
    entries = [{"callsign": "W1AW", "utcDate": "20260830", "utcTime": "120000"}]
    status, _headers, body = request(server, "/api/logbook", {"entries": entries, "adif": "<EOR>\n"}, authed())
    assert status == 200
    written = json.loads(body)
    assert written["count"] == 1

    status, _headers, body = request(server, "/api/logbook", None, authed())
    assert status == 200
    assert json.loads(body)["entries"] == entries

    assert os.path.isfile(written["path"])
    assert os.path.isfile(written["adif_path"])


def test_logbook_rejects_a_non_array_payload(server):
    status, _headers, body = request(server, "/api/logbook", {"entries": {"not": "a list"}}, authed())
    assert status == 500
    assert "array" in json.loads(body)["error"]


def test_station_config_round_trips_to_disk(server):
    config = {"myCall": "W1AW", "regulatoryRegion": "US", "licenseClass": "US_GENERAL"}
    status, _headers, _body = request(server, "/api/station-config", {"config": config}, authed())
    assert status == 200

    status, _headers, body = request(server, "/api/station-config", None, authed())
    assert status == 200
    assert json.loads(body)["config"] == config


# -- port binding ----------------------------------------------------------

def test_bind_fails_loudly_rather_than_drifting_to_another_port():
    """
    Silently moving to an ephemeral port is what orphaned the operator's logbook: browser
    storage is partitioned by origin and the port is part of the origin.
    """
    first, port = ws.bind_listening_socket(0)
    try:
        with pytest.raises(OSError) as excinfo:
            ws.bind_listening_socket(port)
        assert "--port" in str(excinfo.value)
    finally:
        first.close()
