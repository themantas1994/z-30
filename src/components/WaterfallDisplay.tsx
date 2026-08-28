/**
 * High-Performance 60 FPS HTML5 Canvas Spectral Waterfall Display for z-30
 * =========================================================================
 * Features:
 * - 10 User-Selectable Color Palettes (Turbo, Inferno, Viridis, Plasma, Magma, WSJT-X, Night Vision, Amber, B&W, Spectral)
 * - Dynamic Waterfall Speed Control (1x Slow, 2x Normal, 3x Fast, 4x Max)
 * - Dynamic Frequency Range Presets & Custom Passband Selection (Standard, Narrow, Digital, Wide, Extended, Custom)
 * - Enhanced High-Visibility 16-MFSK Signal Tone Synthesis & Contrast Boost
 * - Double-Click Carrier / Signal to Arm TX for Next Cycle
 * - Real-Time Visual Signal Tracking Overlays & Decoded Station Badges
 * - 50 Hz RX/TX passband markers with lock indicators
 * - Interactive Cursor Spectrum Tooltip & Frequency QSY click handler
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ColorPaletteName, DecodedSignal, BandDef } from '../types/z30';
import { Z30_SPECS, HAM_BANDS } from '../dsp/z30Constants';
import { audioEngine } from '../dsp/audioEngine';
import { rigctl } from '../dsp/rigctlSimulator';
import {
  Palette,
  ZoomIn,
  ZoomOut,
  Move,
  Eye,
  Radio,
  Sparkles,
  SlidersHorizontal,
  RefreshCw,
  Volume2,
  Sliders,
  Zap,
  Gauge,
  Layers,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';

interface WaterfallDisplayProps {
  rxFreqHz: number;
  txFreqHz: number;
  onSetRxFreq: (freqHz: number) => void;
  onSetTxFreq: (freqHz: number) => void;
  onDoubleClickSignal?: (signal: DecodedSignal) => void;
  onArmTxAtFreq?: (freqHz: number) => void;
  activeTxSymbols?: number[];
  isTransmitting?: boolean;
  isTuning?: boolean;
  decodes?: DecodedSignal[];
  currentBand?: BandDef;
  dialFreqHz?: number;
  onBandChange?: (bandName: string) => void;
  onOpenBandManager?: () => void;
  fwdWatts?: number;
  swr?: number;
}

export type FreqRangePreset =
  | 'STD_200_3000'
  | 'NARROW_500_2000'
  | 'DIGI_800_1800'
  | 'WIDE_100_3500'
  | 'EXT_0_4000'
  | 'CUSTOM';

// 10 Vectorized Color Palette Functions
function getPaletteColor(val: number, palette: ColorPaletteName): [number, number, number] {
  const norm = Math.max(0, Math.min(1, val));

  switch (palette) {
    case 'turbo': {
      // Turbo rainbow colormap
      const r = Math.sin(norm * Math.PI * 1.5 - 0.5) * 127 + 128;
      const g = Math.sin(norm * Math.PI) * 200 + 40;
      const b = Math.cos(norm * Math.PI * 1.2) * 200 + 55;
      return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
    }
    case 'inferno': {
      // Inferno thermal
      const r = Math.pow(norm, 0.7) * 255;
      const g = Math.pow(norm, 1.8) * 230;
      const b = Math.sin(norm * Math.PI * 0.8) * 180 + (norm > 0.8 ? 150 : 0);
      return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
    }
    case 'viridis': {
      // Viridis standard
      const r = norm < 0.5 ? norm * 100 : (norm - 0.5) * 400 + 50;
      const g = norm * 220 + 30;
      const b = (1 - norm) * 180 + 70;
      return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
    }
    case 'plasma': {
      // Plasma perceptually uniform
      const r = Math.pow(norm, 0.6) * 240 + 15;
      const g = Math.sin(norm * Math.PI * 0.9) * 180;
      const b = Math.cos(norm * Math.PI * 0.7) * 220 + 30;
      return [Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b))];
    }
    case 'magma': {
      // Magma dark-to-bright violet/orange
      const r = norm < 0.3 ? norm * 300 : norm * 200 + 55;
      const g = Math.pow(norm, 2.2) * 240;
      const b = Math.sin(norm * Math.PI * 0.7) * 190 + (norm > 0.9 ? 65 : 10);
      return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
    }
    case 'wsjtx': {
      // Classic WSJT-X Blue-White
      if (norm < 0.2) return [10, 20, Math.round(norm * 400)];
      if (norm < 0.6) return [Math.round((norm - 0.2) * 200), Math.round((norm - 0.2) * 350), 220];
      return [255, 255, Math.round((norm - 0.6) * 600)];
    }
    case 'nightGreen': {
      // Night vision phosphorescent green
      return [Math.round(norm * 30), Math.round(norm * 255), Math.round(norm * 70)];
    }
    case 'amber': {
      // Amber monochrome
      return [Math.round(norm * 255), Math.round(norm * 170), Math.round(norm * 30)];
    }
    case 'highContrast': {
      // High-Contrast Black & White
      const gray = Math.round(Math.pow(norm, 1.2) * 255);
      return [gray, gray, gray];
    }
    case 'spectral': {
      // Spectral Heatmap
      const r = Math.sin(norm * Math.PI - Math.PI / 2) * 127 + 128;
      const g = Math.sin(norm * Math.PI) * 255;
      const b = Math.cos(norm * Math.PI / 2) * 255;
      return [Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b))];
    }
    default:
      return [Math.round(norm * 255), Math.round(norm * 255), Math.round(norm * 255)];
  }
}

export const WaterfallDisplay: React.FC<WaterfallDisplayProps> = ({
  rxFreqHz,
  txFreqHz,
  onSetRxFreq,
  onSetTxFreq,
  onDoubleClickSignal,
  onArmTxAtFreq,
  isTransmitting = false,
  isTuning = false,
  decodes = [],
  currentBand,
  dialFreqHz,
  onBandChange,
  onOpenBandManager,
  fwdWatts = 50.0,
  swr = 1.12,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Power / Volume state in dB (0 dB = 100%, -40 dB = minimum)
  const [powerDb, setPowerDb] = useState<number>(0);
  // Transmitted Audio Power / ALC state in dB (0 dB = 100%, -30 dB = minimum)
  const [txPowerDb, setTxPowerDb] = useState<number>(0);

  // Live S-Meter state
  const [sMeterDb, setSMeterDb] = useState<number>(-95);

  useEffect(() => {
    const timer = setInterval(() => {
      setSMeterDb(rigctl.getSmeterDb());
    }, 120);
    return () => clearInterval(timer);
  }, []);

  const sMeterPercent = Math.max(5, Math.min(100, ((sMeterDb + 130) / 100) * 100));

  const handlePowerChange = (val: number) => {
    setPowerDb(val);
    const linearGain = Math.pow(10, val / 20);
    audioEngine.setMasterVolume(linearGain);
  };

  const handleTxPowerChange = (val: number) => {
    setTxPowerDb(val);
    audioEngine.setTxGainDb(val);
  };

  // Display, Speed & Colormap State
  const [palette, setPalette] = useState<ColorPaletteName>('turbo');
  const [gainDb, setGainDb] = useState<number>(14);
  const [contrast, setContrast] = useState<number>(75);
  const [signalBoost, setSignalBoost] = useState<number>(1.6); // 1.0 = normal, 1.6 = enhanced, 2.2 = ultra visibility
  const [speed, setSpeed] = useState<number>(2); // 1 = Slow, 2 = Normal, 3 = Fast, 4 = Max
  const [showSpectrum, setShowSpectrum] = useState<boolean>(true);
  const [showTrackingOverlays, setShowTrackingOverlays] = useState<boolean>(true);

  // Frequency Range Bounds State
  const [freqRangePreset, setFreqRangePreset] = useState<FreqRangePreset>('STD_200_3000');
  const [customMinFreq, setCustomMinFreq] = useState<number>(200);
  const [customMaxFreq, setCustomMaxFreq] = useState<number>(3000);

  const fullMinFreq = customMinFreq;
  const fullMaxFreq = customMaxFreq;
  const fullSpan = Math.max(200, fullMaxFreq - fullMinFreq);

  // Zoom & Pan State
  const [zoom, setZoom] = useState<number>(1); // 1x, 2x, 4x, 8x
  const [centerFreqHz, setCenterFreqHz] = useState<number>(1600); // Dynamic midpoint
  const [isDraggingPan, setIsDraggingPan] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartCenterFreq, setDragStartCenterFreq] = useState<number>(1600);

  // Interactive Cursor Inspection & Double-Click Toast
  const [cursorFreq, setCursorFreq] = useState<number | null>(null);
  const [cursorPowerDb, setCursorPowerDb] = useState<number | null>(null);
  const [hoveredSignal, setHoveredSignal] = useState<DecodedSignal | null>(null);
  const [armedToastMessage, setArmedToastMessage] = useState<string | null>(null);

  const handleSetFreqPreset = (preset: FreqRangePreset) => {
    setFreqRangePreset(preset);
    if (preset === 'STD_200_3000') {
      setCustomMinFreq(200);
      setCustomMaxFreq(3000);
      setCenterFreqHz(1600);
    } else if (preset === 'NARROW_500_2000') {
      setCustomMinFreq(500);
      setCustomMaxFreq(2000);
      setCenterFreqHz(1250);
    } else if (preset === 'DIGI_800_1800') {
      setCustomMinFreq(800);
      setCustomMaxFreq(1800);
      setCenterFreqHz(1300);
    } else if (preset === 'WIDE_100_3500') {
      setCustomMinFreq(100);
      setCustomMaxFreq(3500);
      setCenterFreqHz(1800);
    } else if (preset === 'EXT_0_4000') {
      setCustomMinFreq(0);
      setCustomMaxFreq(4000);
      setCenterFreqHz(2000);
    }
  };

  // Visible Frequency Span based on Zoom & Center
  const visibleSpan = fullSpan / zoom;
  const halfSpan = visibleSpan / 2;
  const minVisibleFreq = Math.max(fullMinFreq, Math.min(fullMaxFreq - visibleSpan, centerFreqHz - halfSpan));
  const maxVisibleFreq = minVisibleFreq + visibleSpan;

  // Offscreen canvas buffer (Full passband resolution)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize offscreen buffer
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 1600;
    offscreen.height = 320;
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    }
    offscreenCanvasRef.current = offscreen;
  }, []);

  // Helper coordinate conversions
  const freqToCanvasX = useCallback(
    (freqHz: number, width: number): number => {
      return ((freqHz - minVisibleFreq) / visibleSpan) * width;
    },
    [minVisibleFreq, visibleSpan]
  );

  const canvasXToFreq = useCallback(
    (x: number, width: number): number => {
      const ratio = Math.max(0, Math.min(1, x / width));
      return Math.round(minVisibleFreq + ratio * visibleSpan);
    },
    [minVisibleFreq, visibleSpan]
  );

  // Main 60 FPS Non-Blocking Animation Render Loop
  useEffect(() => {
    let animationFrameId: number;
    let lineCounter = 0;

    const render = () => {
      const canvas = canvasRef.current;
      const offscreen = offscreenCanvasRef.current;
      if (!canvas || !offscreen) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext('2d');
      const offCtx = offscreen.getContext('2d');
      if (!ctx || !offCtx) return;

      const width = canvas.width;
      const height = canvas.height;

      // 1. Fetch current live FFT data from Audio Engine
      const fftData = audioEngine.getFrequencyData();
      const analyser = audioEngine.getAnalyser();

      lineCounter++;
      // Speed factor: 1 = every 4 frames, 2 = every 3 frames, 3 = every 2 frames, 4 = every frame
      const stepFrames = speed === 4 ? 1 : speed === 3 ? 2 : speed === 2 ? 3 : 4;

      if (lineCounter >= stepFrames) {
        lineCounter = 0;

        // Shift offscreen waterfall down by 1 pixel
        offCtx.drawImage(
          offscreen,
          0,
          0,
          offscreen.width,
          offscreen.height - 1,
          0,
          1,
          offscreen.width,
          offscreen.height - 1
        );

        // Generate top line across entire selected passband (fullMinFreq to fullMaxFreq)
        const imgData = offCtx.createImageData(offscreen.width, 1);
        const data = imgData.data;

        const binCount = analyser ? analyser.frequencyBinCount : 2048;
        const sampleRate = audioEngine.getAudioContext()?.sampleRate || 48000;
        const nyquist = sampleRate / 2;
        const nowTime = Date.now();

        for (let x = 0; x < offscreen.width; x++) {
          const freqAtX = fullMinFreq + (x / offscreen.width) * fullSpan;
          const bin = Math.floor((freqAtX / nyquist) * binCount);

          // Base background noise magnitude
          let magnitude = 0.08 + Math.random() * 0.05;

          if (fftData && bin >= 0 && bin < fftData.length) {
            magnitude = Math.max(magnitude, fftData[bin] / 255.0);
          }

          // Enhance Visible 16-MFSK Signal Tracks for active decodes
          if (decodes && decodes.length > 0) {
            for (let s = 0; s < decodes.length; s++) {
              const sig = decodes[s];
              const distFromBase = freqAtX - sig.freq;

              // Check if within 50 Hz 16-MFSK signal passband
              if (distFromBase >= -4 && distFromBase <= Z30_SPECS.TOTAL_BANDWIDTH_HZ + 4) {
                // Determine current 16-MFSK tone position based on 320ms symbol slot
                const symbolPeriodIndex = Math.floor(nowTime / 320);
                const activeToneIdx = (symbolPeriodIndex * 7 + sig.freq + (s * 3)) % 16;
                const activeToneFreq = sig.freq + activeToneIdx * Z30_SPECS.TONE_SPACING_HZ;

                // Gaussian tone energy calculation
                const toneDist = Math.abs(freqAtX - activeToneFreq);
                const snrNormalized = Math.max(0.2, Math.min(1.0, (sig.snr + 32) / 45)); // SNR -32dB to +13dB mapped to 0.2 .. 1.0

                // Main peak tone carrier
                if (toneDist < 4.0) {
                  const tonePeak = Math.exp(-(toneDist * toneDist) / 4.0) * (0.55 + snrNormalized * 0.45);
                  magnitude = Math.max(magnitude, tonePeak * signalBoost);
                }

                // Diffused 50 Hz occupied bandwidth pedestal
                const passbandPedestal = 0.18 + snrNormalized * 0.22;
                magnitude = Math.max(magnitude, passbandPedestal * signalBoost);
              }
            }
          }

          // Transmitting or Tuning Carrier Synthesis
          if (isTransmitting || isTuning) {
            const txDist = Math.abs(freqAtX - txFreqHz);
            if (txDist < 8.0) {
              const txToneOffset = isTuning ? 0 : ((Math.floor(nowTime / 320) * 5) % 16) * Z30_SPECS.TONE_SPACING_HZ;
              const actualTxFreq = txFreqHz + txToneOffset;
              const distToTxTone = Math.abs(freqAtX - actualTxFreq);
              if (distToTxTone < 4.5) {
                const txPeak = Math.exp(-(distToTxTone * distToTxTone) / 3.0) * 0.95;
                magnitude = Math.max(magnitude, txPeak);
              }
              magnitude = Math.max(magnitude, 0.45);
            }
          }

          // Color scale normalization
          const adjusted = Math.pow(Math.min(1.0, magnitude * (gainDb / 11)), contrast / 50);
          const [r, g, b] = getPaletteColor(adjusted, palette);

          const idx = x * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }

        offCtx.putImageData(imgData, 0, 0);
      }

      // 2. Render Windowed Zoom Region from Offscreen Buffer to Main Canvas
      const sx = ((minVisibleFreq - fullMinFreq) / fullSpan) * offscreen.width;
      const sWidth = (visibleSpan / fullSpan) * offscreen.width;

      ctx.drawImage(offscreen, sx, 0, sWidth, offscreen.height, 0, 0, width, height);

      // 3. Live Power Spectrum Density (PSD) Overlay
      if (showSpectrum && fftData) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 255, 65, 0.75)';
        ctx.lineWidth = 1.5;

        const binCount = analyser ? analyser.frequencyBinCount : 2048;
        const sampleRate = audioEngine.getAudioContext()?.sampleRate || 48000;
        const nyquist = sampleRate / 2;

        for (let x = 0; x < width; x += 2) {
          const f = canvasXToFreq(x, width);
          const bin = Math.floor((f / nyquist) * binCount);
          let val = (fftData[bin] || 0) / 255.0;

          // Also inject peak for decoded carriers
          if (decodes && decodes.length > 0) {
            for (const sig of decodes) {
              if (Math.abs(f - (sig.freq + 25)) <= 30) {
                const snrNormalized = Math.max(0.1, (sig.snr + 30) / 45);
                val = Math.max(val, 0.35 + snrNormalized * 0.45);
              }
            }
          }

          const y = height * 0.35 - val * height * 0.3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // 4. Frequency Gridlines
      const stepHz = zoom >= 4 ? 25 : zoom >= 2 ? 50 : 100;
      const firstGrid = Math.ceil(minVisibleFreq / stepHz) * stepHz;

      for (let f = firstGrid; f <= maxVisibleFreq; f += stepHz) {
        const x = freqToCanvasX(f, width);
        const isMajor = f % 500 === 0 || (zoom >= 4 && f % 100 === 0);

        ctx.strokeStyle = isMajor ? 'rgba(212, 212, 212, 0.35)' : 'rgba(80, 80, 80, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // 5. Active Signal Tracking Indicators & Decoded Station Badges
      if (showTrackingOverlays && decodes.length > 0) {
        const pulse = (Math.sin(Date.now() / 250) + 1) / 2; // 0.0 to 1.0 blinking pulse

        decodes.slice(0, 10).forEach((sig) => {
          if (sig.freq >= minVisibleFreq - 50 && sig.freq <= maxVisibleFreq + 50) {
            const sigX = freqToCanvasX(sig.freq, width);
            const sigW = Math.max(12, (Z30_SPECS.TOTAL_BANDWIDTH_HZ / visibleSpan) * width);

            // Highlight box
            const isHovered = hoveredSignal?.id === sig.id;
            const sicColor =
              sig.sicPass === 1 ? '#00FF41' : sig.sicPass === 2 ? '#38BDF8' : '#C084FC';

            ctx.fillStyle = isHovered
              ? 'rgba(0, 255, 65, 0.25)'
              : `rgba(${
                  sig.sicPass === 1 ? '0, 255, 65' : sig.sicPass === 2 ? '56, 189, 248' : '192, 132, 252'
                }, ${0.1 + pulse * 0.1})`;
            ctx.fillRect(sigX, 0, sigW, height);

            ctx.strokeStyle = sicColor;
            ctx.lineWidth = isHovered ? 2.5 : 1.5;
            ctx.strokeRect(sigX, 0, sigW, height);

            // Signal Badge at bottom
            const badgeW = Math.max(65, sigW + 10);
            ctx.fillStyle = '#050505';
            ctx.fillRect(Math.max(2, sigX - 4), height - 22, badgeW, 18);
            ctx.strokeStyle = sicColor;
            ctx.strokeRect(Math.max(2, sigX - 4), height - 22, badgeW, 18);

            ctx.fillStyle = sicColor;
            ctx.font = 'bold 9px "Fira Code", monospace';
            const label = sig.callFrom ? `${sig.callFrom}` : `SIC P${sig.sicPass}`;
            ctx.fillText(label, Math.max(4, sigX), height - 9);
          }
        });
      }

      // 6. 50 Hz Passband Brackets: RX (Terminal Green) & TX (Red)
      const rxX = freqToCanvasX(rxFreqHz, width);
      const bwPx = (Z30_SPECS.TOTAL_BANDWIDTH_HZ / visibleSpan) * width;

      // RX Passband
      ctx.fillStyle = 'rgba(0, 255, 65, 0.15)';
      ctx.fillRect(rxX, 0, bwPx, height);
      ctx.strokeStyle = '#00FF41';
      ctx.lineWidth = 2;
      ctx.strokeRect(rxX, 0, bwPx, height);

      ctx.fillStyle = '#00FF41';
      ctx.font = 'bold 10px "Fira Code", monospace';
      ctx.fillText(`RX ${rxFreqHz}Hz`, Math.max(4, rxX - 10), 14);

      // TX Passband
      const txX = freqToCanvasX(txFreqHz, width);
      ctx.fillStyle = isTransmitting ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(txX, 0, bwPx, height);
      ctx.strokeStyle = isTransmitting ? '#F87171' : '#EF4444';
      ctx.lineWidth = isTransmitting ? 3 : 2;
      ctx.strokeRect(txX, 0, bwPx, height);

      ctx.fillStyle = '#EF4444';
      ctx.fillText(`TX ${txFreqHz}Hz`, Math.max(4, txX - 10), 28);

      // 7. Interactive Crosshair & Cursor Readout
      if (cursorFreq !== null) {
        const cursorX = freqToCanvasX(cursorFreq, width);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Readout Tag
        ctx.fillStyle = '#FACC15';
        ctx.font = '10px "Fira Code", monospace';
        const tagText =
          cursorPowerDb !== null ? `${cursorFreq} Hz (${cursorPowerDb} dB)` : `${cursorFreq} Hz`;
        ctx.fillText(tagText, Math.min(width - 90, Math.max(10, cursorX + 5)), height - 30);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    palette,
    gainDb,
    contrast,
    signalBoost,
    speed,
    zoom,
    minVisibleFreq,
    maxVisibleFreq,
    visibleSpan,
    fullMinFreq,
    fullSpan,
    rxFreqHz,
    txFreqHz,
    isTransmitting,
    isTuning,
    cursorFreq,
    cursorPowerDb,
    showSpectrum,
    showTrackingOverlays,
    decodes,
    hoveredSignal,
    canvasXToFreq,
    freqToCanvasX,
  ]);

  // Single Click handler to QSY RX/TX
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || isDraggingPan) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedFreq = canvasXToFreq(x, rect.width);

    if (e.shiftKey) {
      onSetTxFreq(clickedFreq);
    } else {
      onSetRxFreq(clickedFreq);
    }
  };

  // Double Click Handler: Arms TX to transmit next cycle for the target signal
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedFreq = canvasXToFreq(x, rect.width);

    // Search for matching decoded carrier within ±35 Hz
    const matched = decodes.find((d) => Math.abs(d.freq - clickedFreq) <= 35);

    if (matched) {
      onSetRxFreq(matched.freq);
      onSetTxFreq(matched.freq);
      if (onDoubleClickSignal) {
        onDoubleClickSignal(matched);
      }
      setArmedToastMessage(
        `TX ARMED FOR NEXT CYCLE: Calling ${matched.callFrom || 'DX'} @ ${matched.freq} Hz`
      );
    } else {
      onSetRxFreq(clickedFreq);
      onSetTxFreq(clickedFreq);
      if (onArmTxAtFreq) {
        onArmTxAtFreq(clickedFreq);
      }
      setArmedToastMessage(`TX ARMED FOR NEXT CYCLE: Armed @ ${clickedFreq} Hz`);
    }

    setTimeout(() => {
      setArmedToastMessage(null);
    }, 3500);
  };

  // Mouse Move & Hover Inspection
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const currentFreq = canvasXToFreq(x, rect.width);
    setCursorFreq(currentFreq);

    // Pan Dragging
    if (isDraggingPan) {
      const deltaX = e.clientX - dragStartX;
      const freqDelta = -(deltaX / rect.width) * visibleSpan;
      const newCenter = Math.max(
        fullMinFreq + halfSpan,
        Math.min(fullMaxFreq - halfSpan, dragStartCenterFreq + freqDelta)
      );
      setCenterFreqHz(Math.round(newCenter));
      return;
    }

    // Power estimate at cursor
    const fftData = audioEngine.getFrequencyData();
    const analyser = audioEngine.getAnalyser();
    if (fftData && analyser) {
      const sampleRate = audioEngine.getAudioContext()?.sampleRate || 48000;
      const bin = Math.floor((currentFreq / (sampleRate / 2)) * analyser.frequencyBinCount);
      if (bin >= 0 && bin < fftData.length) {
        const val = fftData[bin];
        setCursorPowerDb(Math.round((val / 255) * 60 - 45));
      }
    }

    // Check if hovering near a decoded carrier
    const match = decodes.find((d) => Math.abs(d.freq - currentFreq) <= 30);
    setHoveredSignal(match || null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.altKey || zoom > 1)) {
      setIsDraggingPan(true);
      setDragStartX(e.clientX);
      setDragStartCenterFreq(centerFreqHz);
    }
  };

  const handleMouseUp = () => {
    setIsDraggingPan(false);
  };

  const handleMouseLeave = () => {
    setCursorFreq(null);
    setCursorPowerDb(null);
    setHoveredSignal(null);
    setIsDraggingPan(false);
  };

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      // Zoom in
      setZoom((prev) => Math.min(8, prev * 2));
    } else {
      // Zoom out
      setZoom((prev) => Math.max(1, prev / 2));
    }
  };

  const handleResetPanZoom = () => {
    setZoom(1);
    setCenterFreqHz(Math.round((fullMinFreq + fullMaxFreq) / 2));
  };

  return (
    <div
      className="flex flex-col bg-[#141414] border border-[#333] overflow-hidden font-mono select-none"
      id="z30-waterfall-card"
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333] text-xs gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-1.5 text-[#00FF41] font-bold tracking-wider">
            <span className="inline-block w-2 h-2 bg-[#00FF41] animate-pulse"></span>
            <span>60 FPS SPECTRAL WATERFALL</span>
          </div>
          <span className="text-[#444]">|</span>
          <span className="text-[#888] text-[11px]">
            Span: <strong className="text-[#D4D4D4]">{Math.round(minVisibleFreq)} - {Math.round(maxVisibleFreq)} Hz</strong> ({zoom}x Zoom)
          </span>
        </div>

        {/* Controls Grid */}
        <div className="flex flex-wrap items-center space-x-2">
          {/* Palette Selector */}
          <div className="flex items-center space-x-1">
            <Palette className="w-3.5 h-3.5 text-[#888]" />
            <select
              id="waterfall-palette-select"
              value={palette}
              onChange={(e) => setPalette(e.target.value as ColorPaletteName)}
              className="bg-[#1A1A1A] text-[#D4D4D4] border border-[#333] px-2 py-0.5 text-xs focus:outline-none focus:border-[#00FF41]"
              title="Select Color Palette"
            >
              <option value="turbo">Turbo Rainbow</option>
              <option value="inferno">Inferno Thermal</option>
              <option value="viridis">Viridis Standard</option>
              <option value="plasma">Plasma</option>
              <option value="magma">Magma</option>
              <option value="wsjtx">WSJT-X Blue</option>
              <option value="nightGreen">Night Vision Green</option>
              <option value="amber">Amber Monochrome</option>
              <option value="highContrast">High Contrast B&W</option>
              <option value="spectral">Spectral Heatmap</option>
            </select>
          </div>

          {/* Speed Setting */}
          <div className="flex items-center space-x-1 border border-[#333] bg-[#050505] p-0.5">
            <Gauge className="w-3 h-3 text-[#888] ml-1" />
            <span className="text-[10px] text-[#888] uppercase font-bold px-0.5">Spd:</span>
            {[1, 2, 3, 4].map((s) => (
              <button
                key={s}
                id={`wf-speed-btn-${s}`}
                type="button"
                onClick={() => setSpeed(s)}
                title={`Waterfall scroll speed: ${s}x (${s === 1 ? 'Slow' : s === 2 ? 'Normal' : s === 3 ? 'Fast' : 'Ultra 60 FPS'})`}
                className={`px-1.5 py-0.2 text-[10px] font-bold transition-all ${
                  speed === s
                    ? 'bg-[#00FF41] text-black shadow-[0_0_6px_rgba(0,255,65,0.4)]'
                    : 'text-[#888] hover:text-[#D4D4D4] hover:bg-[#202020]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Frequency Range Setting */}
          <div className="flex items-center space-x-1">
            <Layers className="w-3.5 h-3.5 text-[#888]" />
            <select
              id="waterfall-freq-range-select"
              value={freqRangePreset}
              onChange={(e) => handleSetFreqPreset(e.target.value as FreqRangePreset)}
              className="bg-[#1A1A1A] text-cyan-400 border border-[#333] px-2 py-0.5 text-xs font-bold focus:outline-none focus:border-cyan-400"
              title="Set Waterfall Audio Frequency Passband Range"
            >
              <option value="STD_200_3000">200 - 3000 Hz (Std)</option>
              <option value="NARROW_500_2000">500 - 2000 Hz (Narrow)</option>
              <option value="DIGI_800_1800">800 - 1800 Hz (Digi)</option>
              <option value="WIDE_100_3500">100 - 3500 Hz (Wide)</option>
              <option value="EXT_0_4000">0 - 4000 Hz (Ext)</option>
            </select>
          </div>

          {/* Signal Boost / Contrast Control */}
          <div className="flex items-center space-x-1 border border-[#333] bg-[#050505] p-0.5">
            <Sparkles className="w-3 h-3 text-[#00FF41] ml-1" />
            <span className="text-[10px] text-[#888] font-bold px-0.5">Boost:</span>
            {[1.0, 1.6, 2.2].map((b, idx) => (
              <button
                key={b}
                id={`wf-boost-btn-${idx}`}
                type="button"
                onClick={() => setSignalBoost(b)}
                title={`Signal trace visibility boost: ${idx === 0 ? 'Normal' : idx === 1 ? 'High Visibility' : 'Ultra Weak-Signal Focus'}`}
                className={`px-1.5 py-0.2 text-[10px] font-bold transition-all ${
                  signalBoost === b
                    ? 'bg-yellow-500 text-black shadow-[0_0_6px_rgba(234,179,8,0.4)]'
                    : 'text-[#888] hover:text-[#D4D4D4] hover:bg-[#202020]'
                }`}
              >
                {idx === 0 ? '1x' : idx === 1 ? '1.6x' : '2.2x'}
              </button>
            ))}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center space-x-1 border border-[#333] bg-[#050505] p-0.5">
            <button
              id="wf-zoom-out-btn"
              onClick={() => setZoom((z) => Math.max(1, z / 2))}
              disabled={zoom <= 1}
              className="px-1.5 py-0.5 bg-[#1A1A1A] hover:bg-[#262626] disabled:opacity-30 text-[#D4D4D4] text-xs font-bold"
              title="Zoom Out (or mouse wheel down)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-1 text-[11px] font-bold text-[#00FF41]">{zoom}x</span>
            <button
              id="wf-zoom-in-btn"
              onClick={() => setZoom((z) => Math.min(8, z * 2))}
              disabled={zoom >= 8}
              className="px-1.5 py-0.5 bg-[#1A1A1A] hover:bg-[#262626] disabled:opacity-30 text-[#D4D4D4] text-xs font-bold"
              title="Zoom In (or mouse wheel up)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            {zoom > 1 && (
              <button
                onClick={handleResetPanZoom}
                className="px-1 py-0.5 text-[10px] text-[#888] hover:text-[#D4D4D4]"
                title="Reset Zoom & Pan"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {/* Gain Slider */}
          <div className="flex items-center space-x-1">
            <span className="text-[#888] text-[11px]">Gain:</span>
            <input
              id="waterfall-gain-slider"
              type="range"
              min="4"
              max="26"
              value={gainDb}
              onChange={(e) => setGainDb(Number(e.target.value))}
              className="w-12 h-1 bg-[#333] appearance-none cursor-pointer accent-[#00FF41]"
              title="Waterfall DSP Gain"
            />
            <span className="text-[#00FF41] text-[11px] w-4">{gainDb}</span>
          </div>

          {/* Overlays Toggles */}
          <button
            id="waterfall-toggle-tracking"
            onClick={() => setShowTrackingOverlays(!showTrackingOverlays)}
            className={`px-1.5 py-0.5 border text-xs uppercase tracking-wider transition-colors ${
              showTrackingOverlays
                ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41]'
                : 'bg-[#1A1A1A] border-[#333] text-[#888]'
            }`}
            title="Toggle Live Decoder Carrier Tracking Overlays"
          >
            Track
          </button>

          <button
            id="waterfall-toggle-spectrum"
            onClick={() => setShowSpectrum(!showSpectrum)}
            className={`px-1.5 py-0.5 border text-xs uppercase tracking-wider transition-colors ${
              showSpectrum
                ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41]'
                : 'bg-[#1A1A1A] border-[#333] text-[#888]'
            }`}
            title="Toggle Power Spectrum Density Trace"
          >
            PSD
          </button>
        </div>
      </div>

      {/* Dynamic Frequency Ruler */}
      <div className="relative h-6 bg-[#050505] border-b border-[#333] select-none text-[10px] text-[#888] flex items-center overflow-hidden">
        {Array.from({ length: 16 }, (_, i) => {
          const step = zoom >= 4 ? 25 : zoom >= 2 ? 50 : visibleSpan > 2000 ? 200 : 100;
          const start = Math.ceil(minVisibleFreq / step) * step;
          const f = start + i * step;
          if (f > maxVisibleFreq) return null;
          const leftPct = ((f - minVisibleFreq) / visibleSpan) * 100;
          return (
            <div
              key={f}
              className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${leftPct}%` }}
            >
              <span className="text-[#D4D4D4] font-semibold">{f}</span>
              <div className="w-[1px] h-1.5 bg-[#444] mt-0.5" />
            </div>
          );
        })}
      </div>

      {/* Main Canvas Area + Vertical Power Slider */}
      <div className="flex w-full bg-[#050505] border-b border-[#333]">
        {/* Waterfall Canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 h-44 bg-[#050505] overflow-hidden cursor-crosshair"
        >
          <canvas
            id="z30-waterfall-canvas"
            ref={canvasRef}
            width={1200}
            height={220}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onWheel={handleWheel}
            className="w-full h-full block"
          />

          {/* Double-Click Armed TX Notification Toast */}
          {armedToastMessage && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-black font-bold px-3 py-1 text-xs border border-yellow-300 shadow-[0_0_15px_rgba(234,179,8,0.7)] flex items-center space-x-2 z-20 animate-in zoom-in-95 duration-150">
              <Zap className="w-3.5 h-3.5 fill-current animate-pulse" />
              <span>{armedToastMessage}</span>
            </div>
          )}

          {/* Hovered Signal Inspection Popover */}
          {hoveredSignal && (
            <div className="absolute top-2 left-2 bg-[#0F0F0F]/95 border border-[#00FF41] p-2 text-xs shadow-xl pointer-events-none space-y-0.5 z-10">
              <div className="flex items-center space-x-1.5 text-[#00FF41] font-bold">
                <Radio className="w-3 h-3" />
                <span>
                  {hoveredSignal.callFrom || 'DX CARRIER'} @ {hoveredSignal.freq} Hz
                </span>
              </div>
              <div className="text-[11px] text-[#D4D4D4]">
                Payload: <span className="text-cyan-400 font-bold">{hoveredSignal.message}</span>
              </div>
              <div className="text-[10px] text-[#888] flex space-x-2">
                <span>
                  SNR: <strong className="text-[#00FF41]">{hoveredSignal.snr} dB</strong>
                </span>
                <span>
                  DT: <strong className="text-yellow-400">{hoveredSignal.dt.toFixed(2)}s</strong>
                </span>
                <span>
                  SIC: <strong className="text-purple-400">Pass {hoveredSignal.sicPass}</strong>
                </span>
              </div>
              <div className="text-[9px] text-yellow-400 font-bold pt-0.5">
                Double-click to arm TX for next cycle!
              </div>
            </div>
          )}

          {/* Quick Instructions & Zoom Hint Banner */}
          <div className="absolute bottom-1 right-2 bg-[#050505]/90 border border-[#333] px-2 py-0.5 text-[10px] text-[#888] pointer-events-none flex items-center space-x-2 z-10">
            <span>
              Double-Click: <strong className="text-yellow-400">Arm TX Next Cycle</strong>
            </span>
            <span>•</span>
            <span>
              Click: <strong className="text-[#00FF41]">Set RX</strong>
            </span>
            <span>•</span>
            <span>
              Shift+Click: <strong className="text-red-400">Set TX</strong>
            </span>
            <span>•</span>
            <span>
              Wheel: <strong className="text-cyan-400">Zoom ({zoom}x)</strong>
            </span>
            {zoom > 1 && (
              <>
                <span>•</span>
                <span className="text-yellow-400">Drag to Pan</span>
              </>
            )}
          </div>
        </div>

        {/* Dual Vertical Audio / Power Slider Column (RX Volume & TX ALC) */}
        <div
          className="w-32 sm:w-40 bg-[#0A0A0A] border-l border-[#2E2E2E] flex items-stretch divide-x divide-[#222] select-none font-mono flex-shrink-0"
          id="power-slider-panel"
        >
          {/* Slider 1: RX VOL / POWER */}
          <div className="flex-1 flex flex-col items-center justify-between p-1.5 min-w-0">
            {/* Label & Value in dB */}
            <div className="text-center w-full">
              <div className="text-[8px] sm:text-[9px] font-bold tracking-wider text-[#888] uppercase truncate">
                RX VOL
              </div>
              <div className="text-[11px] sm:text-xs font-bold text-[#00FF41] drop-shadow-[0_0_6px_rgba(0,255,65,0.5)]">
                {powerDb >= 0 ? '+' : ''}
                {powerDb.toFixed(1)} <span className="text-[8px] text-[#888]">dB</span>
              </div>
            </div>

            {/* Vertical Slider Control */}
            <div className="relative flex-1 flex items-center justify-center my-0.5 w-full min-h-[85px]">
              <div className="relative h-24 sm:h-28 w-7 flex items-center justify-center">
                <input
                  id="vertical-rx-power-slider"
                  type="range"
                  min="-40"
                  max="0"
                  step="0.5"
                  value={powerDb}
                  onChange={(e) => handlePowerChange(Number(e.target.value))}
                  className="w-24 sm:w-28 h-1.5 bg-[#222] appearance-none cursor-pointer accent-[#00FF41] -rotate-90 origin-center focus:outline-none"
                  title={`RX Audio Level: ${powerDb >= 0 ? '+' : ''}${powerDb.toFixed(1)} dB`}
                />
              </div>
            </div>

            {/* Level Bar & Quick Scale */}
            <div className="w-full flex flex-col items-center space-y-0.5">
              <div className="w-full h-1 bg-[#181818] border border-[#333] overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    powerDb > -6 ? 'bg-[#00FF41]' : powerDb > -18 ? 'bg-cyan-400' : 'bg-yellow-500'
                  }`}
                  style={{ width: `${Math.max(5, Math.min(100, ((powerDb + 40) / 40) * 100))}%` }}
                />
              </div>
              <div className="flex justify-between w-full text-[7px] text-[#666] leading-none">
                <span>-40</span>
                <span>0dB</span>
              </div>
            </div>
          </div>

          {/* Slider 2: TX AUDIO / ALC POWER */}
          <div className="flex-1 flex flex-col items-center justify-between p-1.5 min-w-0 bg-[#0D0D0D]">
            {/* Label & Value in dB */}
            <div className="text-center w-full">
              <div className="text-[8px] sm:text-[9px] font-bold tracking-wider text-red-400 uppercase truncate">
                TX ALC
              </div>
              <div className="text-[11px] sm:text-xs font-bold text-red-400 drop-shadow-[0_0_6px_rgba(239,68,68,0.5)]">
                {txPowerDb >= 0 ? '+' : ''}
                {txPowerDb.toFixed(1)} <span className="text-[8px] text-[#888]">dB</span>
              </div>
            </div>

            {/* Vertical Slider Control */}
            <div className="relative flex-1 flex items-center justify-center my-0.5 w-full min-h-[85px]">
              <div className="relative h-24 sm:h-28 w-7 flex items-center justify-center">
                <input
                  id="vertical-tx-alc-slider"
                  type="range"
                  min="-30"
                  max="0"
                  step="0.5"
                  value={txPowerDb}
                  onChange={(e) => handleTxPowerChange(Number(e.target.value))}
                  className="w-24 sm:w-28 h-1.5 bg-[#222] appearance-none cursor-pointer accent-red-500 -rotate-90 origin-center focus:outline-none"
                  title={`TX Audio / ALC Level: ${txPowerDb >= 0 ? '+' : ''}${txPowerDb.toFixed(1)} dB (adjust to set radio ALC meter)`}
                />
              </div>
            </div>

            {/* Level Bar & Quick Scale */}
            <div className="w-full flex flex-col items-center space-y-0.5">
              <div className="w-full h-1 bg-[#181818] border border-[#333] overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    txPowerDb > -6 ? 'bg-red-500' : txPowerDb > -15 ? 'bg-yellow-400' : 'bg-cyan-400'
                  }`}
                  style={{ width: `${Math.max(5, Math.min(100, ((txPowerDb + 30) / 30) * 100))}%` }}
                />
              </div>
              <div className="flex justify-between w-full text-[7px] text-[#666] leading-none">
                <span>-30</span>
                <span>0dB</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Signal Strength (S-Meter) Bar at the Bottom of Waterfall */}
      <div
        className="bg-[#0D0D0D] px-3 py-1.5 border-b border-[#2A2A2A] flex items-center justify-between gap-3 text-xs font-mono select-none"
        id="waterfall-smeter-bar"
      >
        {/* Left: S-Meter Readout */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#888]">
            SIGNAL STRENGTH:
          </span>
          <span
            className={`text-xs font-bold ${
              isTransmitting
                ? 'text-red-400'
                : isTuning
                ? 'text-yellow-400'
                : 'text-[#00FF41]'
            }`}
          >
            {isTransmitting
              ? `TX 100% (${fwdWatts.toFixed(1)}W • SWR ${swr.toFixed(2)})`
              : isTuning
              ? `TUNE CW (${fwdWatts.toFixed(1)}W)`
              : `S${Math.min(9, Math.max(1, Math.round(sMeterPercent / 10)))} (${sMeterDb.toFixed(0)} dBm)`}
          </span>
        </div>

        {/* Center: Graphical Multi-Segment S-Meter Scale */}
        <div className="flex-1 max-w-xl flex flex-col space-y-0.5">
          <div className="relative w-full h-2.5 bg-[#141414] border border-[#333] overflow-hidden">
            <div
              className={`h-full transition-all duration-100 ${
                isTransmitting
                  ? 'bg-red-500'
                  : isTuning
                  ? 'bg-yellow-500'
                  : sMeterPercent > 60
                  ? 'bg-gradient-to-r from-[#00FF41] via-yellow-400 to-red-500'
                  : 'bg-[#00FF41]'
              }`}
              style={{ width: `${isTransmitting || isTuning ? 100 : sMeterPercent}%` }}
            />
          </div>
          {/* S-Meter Graduations */}
          <div className="flex justify-between text-[8px] text-[#666] font-mono px-0.5 leading-none">
            <span>S1</span>
            <span>S3</span>
            <span>S5</span>
            <span>S7</span>
            <span className="text-[#00FF41] font-semibold">S9</span>
            <span className="text-yellow-400">+10</span>
            <span className="text-yellow-500">+20</span>
            <span className="text-red-400">+30</span>
            <span className="text-red-500 font-bold">+40</span>
          </div>
        </div>

        {/* Right: Mode & Transceiver Info */}
        <div className="hidden sm:flex items-center space-x-2 text-[10px] text-[#888] flex-shrink-0">
          <span>
            AGC: <strong className="text-cyan-400">FAST</strong>
          </span>
          <span>•</span>
          <span>
            BW: <strong className="text-[#00FF41]">50 Hz</strong>
          </span>
        </div>
      </div>

      {/* Amateur Band Presets Strip (All 13 Bands - No Scrolling Needed) */}
      <div
        className="bg-[#080808] px-2 py-1.5 flex items-center justify-between gap-1 select-none font-mono"
        id="waterfall-bands-strip"
      >
        <div className="flex items-center space-x-1.5 flex-shrink-0 mr-1">
          <Radio className="w-3 h-3 text-[#00FF41]" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#888]">
            BANDS:
          </span>
        </div>

        {/* 13 Band Buttons Strip */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar py-0.5">
          {HAM_BANDS.map((b) => {
            const isCurrent = currentBand && b.name === currentBand.name;
            const currentFreq = dialFreqHz && isCurrent ? dialFreqHz : b.dialFreqHz;
            return (
              <button
                key={b.name}
                id={`wf-band-btn-${b.name}`}
                type="button"
                onClick={() => onBandChange && onBandChange(b.name)}
                title={`${b.name} — Dial: ${(currentFreq / 1e6).toFixed(6)} MHz`}
                className={`py-1 px-1.5 sm:px-2 text-center text-[11px] sm:text-xs font-bold transition-all border flex-1 min-w-[38px] ${
                  isCurrent
                    ? 'bg-[#00FF41] text-black border-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.4)] scale-[1.02]'
                    : 'bg-[#141414] hover:bg-[#202020] border-[#2A2A2A] text-[#AAA] hover:text-[#FFF]'
                }`}
              >
                <div className="leading-tight">{b.name}</div>
              </button>
            );
          })}
        </div>

        {/* Band Manager Settings Trigger */}
        {onOpenBandManager && (
          <button
            type="button"
            id="wf-open-band-manager-btn"
            onClick={onOpenBandManager}
            className="flex-shrink-0 px-2 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#00FF41] border border-[#00FF41]/40 text-[10px] font-bold uppercase flex items-center space-x-1 transition-colors ml-1"
            title="Open Band Manager (band_manager.py) to configure dial presets"
          >
            <Sliders className="w-3 h-3" />
            <span className="hidden md:inline">Presets</span>
          </button>
        )}
      </div>
    </div>
  );
};
