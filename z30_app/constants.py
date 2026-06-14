"""Z-30 protocol and application constants."""

SAMPLE_RATE = 12000
BAUD_RATE = 3.125
TONE_SPACING = 3.125
M_TONES = 16
SYMBOL_DURATION = 1.0 / BAUD_RATE
CYCLE_SECONDS = 30

CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ /-?."
CHAR_TO_VAL = {char: idx for idx, char in enumerate(CHARSET)}
VAL_TO_CHAR = {idx: char for idx, char in enumerate(CHARSET)}

FREQ_MIN_HZ = 0
FREQ_MAX_HZ = 3000
DEFAULT_RX_FREQ = 1500
DEFAULT_TX_FREQ = 1500

DECODE_COLORS = {
    "cq": "#4caf50",
    "directed": "#ffeb3b",
    "worked": "#9e9e9e",
    "new_dxcc": "#e040fb",
    "rr73": "#2196f3",
    "73": "#00bcd4",
    "new_grid": "#ff9800",
    "default": "#d4d4d4",
}

RADIO_MODELS = {
    "1 - Dummy": 1,
    "2 - NET rigctl": 2,
    "3073 - Icom IC-7300": 3073,
    "3074 - Icom IC-7610": 3074,
    "1025 - Yaesu FT-991": 1025,
}

WATERFALL_PALETTES = ("WSJT-X Style", "Dark SDR", "Gray Scale", "Inferno", "Viridis")
