"""QSO auto-sequence state machine."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class QSOState(str, Enum):
    CQ = "CQ"
    REPLY = "Reply"
    REPORT = "Report"
    R_REPORT = "R+Report"
    RR73 = "RR73"
    SEVENTY_THREE = "73"


STATE_TO_TX_SLOT = {
    QSOState.CQ: 1,
    QSOState.REPLY: 2,
    QSOState.REPORT: 3,
    QSOState.R_REPORT: 4,
    QSOState.RR73: 5,
    QSOState.SEVENTY_THREE: 6,
}

NEXT_STATE = {
    QSOState.CQ: QSOState.REPLY,
    QSOState.REPLY: QSOState.REPORT,
    QSOState.REPORT: QSOState.R_REPORT,
    QSOState.R_REPORT: QSOState.RR73,
    QSOState.RR73: QSOState.SEVENTY_THREE,
    QSOState.SEVENTY_THREE: QSOState.CQ,
}


@dataclass
class QSOContext:
    my_call: str
    my_grid: str
    dx_call: str = ""
    dx_grid: str = ""
    report_sent: str = "-15"
    report_rcvd: str = ""


class AutoSequencer:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.state = QSOState.CQ
        self.context = QSOContext(my_call="N0CALL", my_grid="FN20")

    def set_operator(self, my_call: str, my_grid: str) -> None:
        self.context.my_call = my_call.upper()
        self.context.my_grid = my_grid.upper()

    def set_dx(self, dx_call: str, dx_grid: str = "") -> None:
        self.context.dx_call = dx_call.upper()
        self.context.dx_grid = dx_grid.upper()

    def tx_slot(self) -> int:
        return STATE_TO_TX_SLOT[self.state]

    def compose_messages(self) -> dict[int, str]:
        c = self.context
        msgs = {1: f"CQ {c.my_call} {c.my_grid}"}
        if c.dx_call:
            msgs[2] = f"{c.dx_call} {c.my_call} {c.my_grid}"
            msgs[3] = f"{c.dx_call} {c.my_call} {c.report_sent}"
            msgs[4] = f"{c.dx_call} {c.my_call} R{c.report_sent}"
            msgs[5] = f"{c.dx_call} {c.my_call} RR73"
            msgs[6] = f"{c.dx_call} {c.my_call} 73"
        return msgs

    def next_tx_message(self) -> str:
        return self.compose_messages().get(self.tx_slot(), "")

    def advance(self) -> QSOState:
        self.state = NEXT_STATE[self.state]
        return self.state

    def on_decode(self, message: str) -> None:
        parts = message.upper().split()
        if not parts:
            return
        if parts[0] == "CQ" and len(parts) >= 2:
            self.state = QSOState.REPLY
            self.set_dx(parts[1], parts[2] if len(parts) > 2 else "")
        elif len(parts) >= 2 and parts[1] == self.context.my_call:
            self.set_dx(parts[0])
            if "RR73" in message.upper():
                self.state = QSOState.SEVENTY_THREE
            elif message.upper().rstrip().endswith("73"):
                self.state = QSOState.CQ
            elif "R-" in message.upper() or "R+" in message.upper() or " R" in message.upper():
                self.state = QSOState.RR73
            else:
                self.state = QSOState.REPORT
        elif "RR73" in message.upper():
            self.state = QSOState.SEVENTY_THREE

    def reset_cq(self) -> None:
        self.state = QSOState.CQ
