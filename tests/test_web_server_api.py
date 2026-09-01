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
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest

from z30_dsp import web_server as ws

TOKEN = "test-token-not-a-real-one"


class FakeGpioDevice:
    """
    Stands in for gpiozero's DigitalOutputDevice so the bridge can be tested off a Pi.

    `active_high` is modelled because the PTT polarity rides on it: `value` is the LOGICAL
    state (on() = keyed, as gpiozero defines it) while `level` is the voltage actually on the
    pin. The two differ on an active-low interface, and that difference is the whole of the
    dead-man switch bug these tests now pin down.
    """

    def __init__(self, pin: int, active_high: bool = True, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_high = active_high
        self.value = bool(initial_value)
        self.closed = False

    @property
    def level(self) -> bool:
        """The electrical level on the pin, which is what the radio's PTT input sees."""
        return self.value if self.active_high else not self.value

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
    BoundHandler.update_job = ws.UpdateJob()
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
    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "keyed": True}, authed())
    assert status == 200
    assert bridge._devices[17].value is True  # noqa: SLF001

    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "keyed": False}, authed())
    assert status == 200
    assert bridge._devices[17].value is False  # noqa: SLF001


def test_a_legacy_value_only_body_still_keys_active_high(server, bridge):
    """
    A cached older bundle sends {"pin", "value"} with no intent field. Reading it as an
    active-high level keeps that station working; rejecting it would strand a browser holding
    a stale cache with a transmitter it can key but not release.
    """
    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "value": True}, authed())
    assert status == 200
    assert bridge._devices[17].value is True  # noqa: SLF001
    assert bridge.any_pin_keyed() is True

    request(server, "/api/gpio", {"pin": 17, "value": False}, authed())
    assert bridge.any_pin_keyed() is False


# -- PTT polarity ----------------------------------------------------------
#
# The browser used to send the electrical LEVEL and this server recorded it as the keyed
# state. On an active-low station the two are opposites, so keying registered no dead-man
# countdown - the browser's own keepalives were then rejected and it force-unkeyed the
# transmitter about half a second into every frame - while releasing registered one, after
# which the watchdog "released" the line by driving it low, which on active-low wiring keys
# the transmitter with nobody watching.

def test_active_low_keying_drives_the_line_low_and_registers_the_dead_man(server, bridge):
    status, _headers, body = request(
        server, "/api/gpio", {"pin": 17, "keyed": True, "active_low": True}, authed()
    )
    assert status == 200
    device = bridge._devices[17]  # noqa: SLF001
    assert device.level is False, "an active-low station keys by pulling the line to ground"
    assert device.value is True, "...which is the KEYED state, not a released one"
    assert bridge.any_pin_keyed() is True
    assert bridge.keepalive(17)["success"] is True, "the station's own keepalives must be accepted"

    assert json.loads(body)["keyed"] is True


def test_active_low_release_raises_the_line_and_clears_the_dead_man(server, bridge):
    request(server, "/api/gpio", {"pin": 17, "keyed": True, "active_low": True}, authed())
    request(server, "/api/gpio", {"pin": 17, "keyed": False, "active_low": True}, authed())

    device = bridge._devices[17]  # noqa: SLF001
    assert device.level is True, "releasing an active-low station lets the line rise"
    assert bridge.any_pin_keyed() is False, "a released transmitter must not hold a countdown"


def test_the_watchdog_never_keys_an_active_low_station(bridge, monkeypatch):
    """The stuck-transmitter defence must not be able to create the thing it defends against."""
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.3)
    bridge.set_pin(17, True, True)
    bridge.set_pin(17, False, True)
    device = bridge._devices[17]  # noqa: SLF001

    time.sleep(0.7)
    assert device.level is True, "the watchdog drove an already-released active-low line into TX"
    assert device.value is False


def test_the_watchdog_releases_a_keyed_active_low_station(bridge, monkeypatch):
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.3)
    bridge.set_pin(17, True, True)
    device = bridge._devices[17]  # noqa: SLF001
    assert device.level is False

    time.sleep(0.7)
    assert device.level is True, "the watchdog did not release an active-low PTT line"


def test_release_all_leaves_an_active_low_line_released(bridge):
    bridge.set_pin(17, True, True)
    device = bridge._devices[17]  # noqa: SLF001
    bridge.release_all()
    assert device.level is True, "shutdown left an active-low transmitter keyed"
    assert device.closed is True


def test_changing_polarity_rebuilds_the_pin_rather_than_reinterpreting_it(bridge):
    bridge.set_pin(17, True, False)
    first = bridge._devices[17]  # noqa: SLF001
    assert first.level is True

    bridge.set_pin(17, False, False)
    bridge.set_pin(17, True, True)
    second = bridge._devices[17]  # noqa: SLF001
    assert second is not first, "the device must be rebuilt when the wiring polarity changes"
    assert second.level is False


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


def test_the_listening_socket_uses_the_right_exclusivity_option_for_this_platform():
    """
    SO_REUSEADDR means opposite things on POSIX and Windows, and only the POSIX meaning is the
    one wanted here.

    On POSIX it permits rebinding an address still in TIME_WAIT - what a restart needs. On
    Windows it permits binding a port another socket is ACTIVELY listening on, so two instances
    both bind, both "succeed", and the OS decides which one receives a given connection. On a
    server that mints a bearer token per start, that decides which process the browser is
    talking to. The test above could not see this on Linux; the Windows CI leg could.

    Asserted from the socket the function actually returns, per platform, rather than by reading
    the branch back out of the source.
    """
    sock, _port = ws.bind_listening_socket(0)
    try:
        if sys.platform == "win32":
            exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE")
            assert sock.getsockopt(socket.SOL_SOCKET, exclusive) != 0, (
                "SO_EXCLUSIVEADDRUSE is not set, so a second instance can bind this same port"
            )
            assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR) == 0, (
                "SO_REUSEADDR is set on Windows, where it permits hijacking an active port"
            )
        else:
            assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR) != 0, (
                "SO_REUSEADDR is not set, so a restart must wait out TIME_WAIT"
            )
    finally:
        sock.close()


# -- upstream update endpoints ---------------------------------------------
#
# The update endpoints fast-forward the operator's checkout of the software that keys their
# transmitter, from a button in a browser. They sit behind the same token/Origin/Host triple
# check as everything else here, and behind one guard of their own.

def test_update_status_requires_the_token_like_every_other_endpoint(server):
    status, _headers, body = request(server, "/api/update/status?fetch=0")
    assert status == 403
    assert "token" in json.loads(body)["error"].lower()


def test_update_apply_requires_the_token(server):
    status, _headers, body = request(
        server, "/api/update/apply", {}, {"Content-Type": "text/plain"}
    )
    assert status == 403
    assert "token" in json.loads(body)["error"].lower()


def test_update_status_reports_the_checkout_without_touching_the_network(server):
    status, _headers, body = request(server, "/api/update/status?fetch=0", None, authed())
    assert status == 200
    payload = json.loads(body)
    assert payload["success"] is True
    # Commits, not versions: there is no version field to compare and none is reported.
    for key in ("behind", "ahead", "local_commit", "upstream_commit", "can_update", "pending"):
        assert key in payload
    assert "latest_version" not in payload


def test_update_is_refused_while_the_transmitter_is_keyed(server, bridge):
    """
    Swapping the served bundle and the Python sources out from under a keyed transmitter is
    not something to do to an operator who is on the air and not looking at the screen.
    """
    keyed = bridge.set_pin(17, True)
    assert keyed["success"] is True
    assert bridge.any_pin_keyed() is True

    status, _headers, body = request(server, "/api/update/apply", {}, authed())
    assert status == 409
    assert "keyed" in json.loads(body)["error"].lower()

    # And the refusal did not touch the transmitter on its way out.
    assert bridge.any_pin_keyed() is True
    bridge.set_pin(17, False)


def test_update_progress_is_readable_before_any_update_has_run(server):
    status, _headers, body = request(server, "/api/update/progress", None, authed())
    assert status == 200
    payload = json.loads(body)
    assert payload["running"] is False
    assert payload["log"] == []
    assert payload["result"] is None
