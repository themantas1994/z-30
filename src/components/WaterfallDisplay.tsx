/**
 * High-Performance 60 FPS HTML5 Canvas Spectral Waterfall Display for z-30
 * =========================================================================
 * Features:
 * - 10 User-Selectable Color Palettes (Turbo, Inferno, Viridis, Plasma, Magma, WSJT-X, Night Vision, Amber, B&W, Spectral)
 * - Dynamic Zoom (1x, 2x, 4x, 8x) and Pan (Drag-to-pan, Wheel Zoom, Center Frequency Slider)
 * - Real-Time Visual Signal Tracking Indicators:
 *   * Blinking/pulsing bounding boxes for actively tracked / decoded carriers
 *   * SIC Pass tags (Pass 1, Pass 2, Pass 3) and Callsign badges
 *   * 50 Hz RX/TX passband markers with lock indicators
 * - Interactive Cursor Spectrum Tooltip & Frequency QSY click handler
 * - Non-blocking Offscreen Canvas Buffer Architecture for 60 FPS Fluidity
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ColorPaletteName, DecodedSignal } from '../types/z30';
import { Z30_SPECS } from '../dsp/z30Constants';
import { audioEngine } from '../dsp/audioEngine';
import { Palette, ZoomIn, ZoomOut, Move, Eye, Radio, Sparkles, SlidersHorizontal, RefreshCw } from 'lucide-react';

interface WaterfallDisplayProps {
  rxFreqHz: number;
  txFreqHz: number;
  onSetRxFreq: (freqHz: number) => void;
  onSetTxFreq: (freqHz: number) => void;
  activeTxSymbols?: number[];
  isTransmitting?: boolean;
  decodes?: DecodedSignal[];
}

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
  isTransmitting = false,
  decodes = [],
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Display & Colormap State
  const [palette, setPalette] = useState<ColorPaletteName>('turbo');
  const [gainDb, setGainDb] = useState<number>(12);
  const [contrast, setContrast] = useState<number>(75);
  const [speed, setSpeed] = useState<number>(2);
  const [showSpectrum, setShowSpectrum] = useState<boolean>(true);
  const [showTrackingOverlays, setShowTrackingOverlays] = useState<boolean>(true);

  // Zoom & Pan State
  const [zoom, setZoom] = useState<number>(1); // 1x, 2x, 4x, 8x
  const [centerFreqHz, setCenterFreqHz] = useState<number>(1600); // 200 to 3000 Hz midpoint
  const [isDraggingPan, setIsDraggingPan] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartCenterFreq, setDragStartCenterFreq] = useState<number>(1600);

  // Interactive Cursor Inspection
  const [cursorFreq, setCursorFreq] = useState<number | null>(null);
  const [cursorPowerDb, setCursorPowerDb] = useState<number | null>(null);
  const [hoveredSignal, setHoveredSignal] = useState<DecodedSignal | null>(null);

  const fullMinFreq = Z30_SPECS.WATERFALL_MIN_FREQ; // 200 Hz
  const fullMaxFreq = Z30_SPECS.WATERFALL_MAX_FREQ; // 3000 Hz
  const fullSpan = fullMaxFreq - fullMinFreq; // 2800 Hz

  // Visible Frequency Span based on Zoom & Center
  const visibleSpan = fullSpan / zoom;
  const halfSpan = visibleSpan / 2;
  const minVisibleFreq = Math.max(fullMinFreq, Math.min(fullMaxFreq - visibleSpan, centerFreqHz - halfSpan));
  const maxVisibleFreq = minVisibleFreq + visibleSpan;

  // Offscreen canvas buffer (Full 2800 Hz passband resolution)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize offscreen buffer
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 1400;
    offscreen.height = 300;
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    }
    offscreenCanvasRef.current = offscreen;
  }, []);

  // Helper coordinate conversions
  const freqToCanvasX = useCallback((freqHz: number, width: number): number => {
    return ((freqHz - minVisibleFreq) / visibleSpan) * width;
  }, [minVisibleFreq, visibleSpan]);

  const canvasXToFreq = useCallback((x: number, width: number): number => {
    const ratio = Math.max(0, Math.min(1, x / width));
    return Math.round(minVisibleFreq + ratio * visibleSpan);
  }, [minVisibleFreq, visibleSpan]);

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

      // 1. Fetch current FFT data
      const fftData = audioEngine.getFrequencyData();
      const analyser = audioEngine.getAnalyser();

      lineCounter++;
      if (lineCounter >= (5 - speed)) {
        lineCounter = 0;

        // Shift offscreen waterfall down
        offCtx.drawImage(offscreen, 0, 0, offscreen.width, offscreen.height - 1, 0, 1, offscreen.width, offscreen.height - 1);

        // Generate top line across entire 200-3000 Hz passband
        const imgData = offCtx.createImageData(offscreen.width, 1);
        const data = imgData.data;

        const binCount = analyser ? analyser.frequencyBinCount : 2048;
        const sampleRate = audioEngine.getAudioContext()?.sampleRate || 48000;
        const nyquist = sampleRate / 2;

        for (let x = 0; x < offscreen.width; x++) {
          const freqAtX = fullMinFreq + (x / offscreen.width) * fullSpan;
          const bin = Math.floor((freqAtX / nyquist) * binCount);

          let magnitude = 0;
          if (fftData && bin >= 0 && bin < fftData.length) {
            magnitude = fftData[bin] / 255.0;
          } else {
            magnitude = 0.10 + Math.random() * 0.08;
          }

          const adjusted = Math.pow(magnitude * (gainDb / 10), contrast / 50);
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

      ctx.drawImage(
        offscreen,
        sx, 0, sWidth, offscreen.height,
        0, 0, width, height
      );

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
          const val = (fftData[bin] || 0) / 255.0;
          const y = height * 0.35 - (val * height * 0.3);

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

        decodes.slice(0, 8).forEach((sig) => {
          if (sig.freq >= minVisibleFreq - 50 && sig.freq <= maxVisibleFreq + 50) {
            const sigX = freqToCanvasX(sig.freq, width);
            const sigW = (Z30_SPECS.TOTAL_BANDWIDTH_HZ / visibleSpan) * width;

            // Highlight box
            const isHovered = hoveredSignal?.id === sig.id;
            const sicColor = sig.sicPass === 1 ? '#00FF41' : sig.sicPass === 2 ? '#38BDF8' : '#C084FC';

            ctx.fillStyle = isHovered
              ? 'rgba(0, 255, 65, 0.25)'
              : `rgba(${sig.sicPass === 1 ? '0, 255, 65' : sig.sicPass === 2 ? '56, 189, 248' : '192, 132, 252'}, ${0.08 + pulse * 0.08})`;
            ctx.fillRect(sigX, 0, sigW, height);

            ctx.strokeStyle = sicColor;
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.strokeRect(sigX, 0, sigW, height);

            // Signal Badge
            ctx.fillStyle = '#050505';
            ctx.fillRect(Math.max(2, sigX - 4), height - 22, Math.max(55, sigW + 8), 18);
            ctx.strokeStyle = sicColor;
            ctx.strokeRect(Math.max(2, sigX - 4), height - 22, Math.max(55, sigW + 8), 18);

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
      ctx.fillText(`RX ${rxFreqHz}Hz [50Hz]`, Math.max(4, rxX - 10), 14);

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
        const tagText = cursorPowerDb !== null ? `${cursorFreq} Hz (${cursorPowerDb} dB)` : `${cursorFreq} Hz`;
        ctx.fillText(tagText, Math.min(width - 90, Math.max(10, cursorX + 5)), height - 30);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    palette, gainDb, contrast, speed, zoom, minVisibleFreq, maxVisibleFreq,
    visibleSpan, rxFreqHz, txFreqHz, isTransmitting, cursorFreq, cursorPowerDb,
    showSpectrum, showTrackingOverlays, decodes, hoveredSignal, canvasXToFreq, freqToCanvasX
  ]);

  // Click handler to QSY RX/TX
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
      const newCenter = Math.max(fullMinFreq + halfSpan, Math.min(fullMaxFreq - halfSpan, dragStartCenterFreq + freqDelta));
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
    setCenterFreqHz(1600);
  };

  return (
    <div className="flex flex-col bg-[#141414] border border-[#333] overflow-hidden font-mono" id="z30-waterfall-card">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333] text-xs gap-2">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-[#00FF41] font-bold tracking-wider">
            <span className="inline-block w-2 h-2 bg-[#00FF41] animate-pulse"></span>
            <span>60 FPS SPECTRAL WATERFALL</span>
          </div>
          <span className="text-[#444]">|</span>
          <span className="text-[#888] text-[11px]">
            Span: <strong className="text-[#D4D4D4]">{Math.round(minVisibleFreq)} - {Math.round(maxVisibleFreq)} Hz</strong> ({zoom}x Zoom)
          </span>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center space-x-2.5">
          {/* Palette Selector */}
          <div className="flex items-center space-x-1">
            <Palette className="w-3.5 h-3.5 text-[#888]" />
            <select
              id="waterfall-palette-select"
              value={palette}
              onChange={(e) => setPalette(e.target.value as ColorPaletteName)}
              className="bg-[#1A1A1A] text-[#D4D4D4] border border-[#333] px-2 py-0.5 text-xs focus:outline-none focus:border-[#00FF41]"
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

          {/* Pan Slider (when zoomed) */}
          {zoom > 1 && (
            <div className="flex items-center space-x-1">
              <Move className="w-3 h-3 text-[#888]" />
              <input
                type="range"
                min={fullMinFreq + halfSpan}
                max={fullMaxFreq - halfSpan}
                value={centerFreqHz}
                onChange={(e) => setCenterFreqHz(Number(e.target.value))}
                className="w-16 h-1 bg-[#333] appearance-none cursor-pointer accent-[#00FF41]"
                title="Pan Center Frequency"
              />
            </div>
          )}

          {/* Gain & Contrast */}
          <div className="flex items-center space-x-1">
            <span className="text-[#888] text-[11px]">Gain:</span>
            <input
              id="waterfall-gain-slider"
              type="range"
              min="4"
              max="24"
              value={gainDb}
              onChange={(e) => setGainDb(Number(e.target.value))}
              className="w-14 h-1 bg-[#333] appearance-none cursor-pointer accent-[#00FF41]"
            />
            <span className="text-[#00FF41] text-[11px] w-4">{gainDb}</span>
          </div>

          {/* Overlays Toggles */}
          <button
            id="waterfall-toggle-tracking"
            onClick={() => setShowTrackingOverlays(!showTrackingOverlays)}
            className={`px-1.5 py-0.5 border text-xs uppercase tracking-wider transition-colors ${
              showTrackingOverlays ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41]' : 'bg-[#1A1A1A] border-[#333] text-[#888]'
            }`}
            title="Toggle Live Decoder Carrier Tracking Overlays"
          >
            Track
          </button>

          <button
            id="waterfall-toggle-spectrum"
            onClick={() => setShowSpectrum(!showSpectrum)}
            className={`px-1.5 py-0.5 border text-xs uppercase tracking-wider transition-colors ${
              showSpectrum ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41]' : 'bg-[#1A1A1A] border-[#333] text-[#888]'
            }`}
            title="Toggle Power Spectrum Density Trace"
          >
            PSD
          </button>
        </div>
      </div>

      {/* Dynamic Frequency Ruler */}
      <div className="relative h-6 bg-[#050505] border-b border-[#333] select-none text-[10px] text-[#888] flex items-center overflow-hidden">
        {Array.from({ length: 15 }, (_, i) => {
          const step = zoom >= 4 ? 50 : zoom >= 2 ? 100 : 200;
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

      {/* Main Canvas Area */}
      <div ref={containerRef} className="relative w-full h-44 bg-[#050505] overflow-hidden cursor-crosshair">
        <canvas
          id="z30-waterfall-canvas"
          ref={canvasRef}
          width={1200}
          height={220}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          className="w-full h-full block"
        />

        {/* Hovered Signal Inspection Popover */}
        {hoveredSignal && (
          <div className="absolute top-2 left-2 bg-[#0F0F0F]/95 border border-[#00FF41] p-2 text-xs shadow-xl pointer-events-none space-y-0.5">
            <div className="flex items-center space-x-1.5 text-[#00FF41] font-bold">
              <Radio className="w-3 h-3" />
              <span>{hoveredSignal.callFrom || 'DX CARRIER'} @ {hoveredSignal.freq} Hz</span>
            </div>
            <div className="text-[11px] text-[#D4D4D4]">
              Payload: <span className="text-cyan-400 font-bold">{hoveredSignal.message}</span>
            </div>
            <div className="text-[10px] text-[#888] flex space-x-2">
              <span>SNR: <strong className="text-[#00FF41]">{hoveredSignal.snr} dB</strong></span>
              <span>DT: <strong className="text-yellow-400">{hoveredSignal.dt.toFixed(2)}s</strong></span>
              <span>SIC: <strong className="text-purple-400">Pass {hoveredSignal.sicPass}</strong></span>
            </div>
          </div>
        )}

        {/* Quick Instructions & Zoom Hint Banner */}
        <div className="absolute bottom-1 right-2 bg-[#050505]/90 border border-[#333] px-2 py-0.5 text-[10px] text-[#888] pointer-events-none flex items-center space-x-2">
          <span>Click: <strong className="text-[#00FF41]">Set RX</strong></span>
          <span>•</span>
          <span>Shift+Click: <strong className="text-red-400">Set TX</strong></span>
          <span>•</span>
          <span>Wheel: <strong className="text-cyan-400">Zoom ({zoom}x)</strong></span>
          {zoom > 1 && (
            <>
              <span>•</span>
              <span className="text-yellow-400">Drag to Pan</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
