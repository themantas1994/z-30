# 08. Web & PWA Architecture

This document describes the modern web architecture of the **z-30** transceiver client, built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and the **HTML5 Web Audio & Canvas APIs**.

---

## 🏗️ Architecture & Component Hierarchy

```
                                    App.tsx (Master Transceiver Hub)
                                                  │
   ┌──────────────────────┬───────────────────────┼───────────────────────┬──────────────────────┐
   │                      │                       │                       │                      │
[ Header.tsx ]    [ WaterfallDisplay.tsx ] [ ActivityLogTable.tsx ] [ QsoMacrosTransmitPanel.tsx ] [ QsoController.tsx ]
- UTC Clock       - 60 FPS Canvas          - Filter Matrix        - 6 TX Macros          - DX Target State
- 30s Progress    - 10 Scientific Palettes - Decodes History      - Auto-Reply Rules     - S-Meter / SWR
- TX/Tune Hooks   - Carrier Arming Hook    - SIC Pass Badges      - PTT Watchdog Timer   - Power Display
```

---

## 🔊 Web Audio API Pipeline (`src/dsp/audioEngine.ts`)

The audio engine processes both synthesized transmission tones and digitized receiver audio in real-time:

### 1. Transmission Tone Synthesis
- **Sample Rate**: $48000\text{ Hz}$ internal sampling rate.
- **Waveform**: Smooth continuous-phase sine synthesizer with raised-cosine windowing across symbol transitions:
  ```typescript
  // 320ms per symbol with phase continuity
  phase += 2 * Math.PI * currentToneFreqHz / sampleRate;
  ```
- **Stereo Routing**:
  - **Left Channel**: 16-MFSK Digital Audio modulation.
  - **Right Channel**: Optional 1000/1500 Hz sinusoidal PTT keying tone for audio-switched interfaces.

### 2. Live Receiver Audio Capture
- Uses `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })` to obtain raw unadulterated RF audio.
- Routes through an `AudioContext` and `AnalyserNode` with an FFT size of $4096$ bins ($11.7\text{ Hz/bin}$) for 60 FPS waterfall rendering.

---

## 🎨 60 FPS HTML5 Canvas Waterfall Engine (`src/dsp/WaterfallDisplay.tsx`)

- **High-Performance Direct Pixel Buffer**: Manipulates raw 32-bit `Uint32Array` pixel memory inside an `ImageData` buffer to achieve a continuous 60 frames per second with $< 2\%$ CPU utilization.
- **10 Scientific Colormaps**: Precomputed 256-level RGB look-up tables (LUTs):
  1. `Turbo` (Google DeepMind Perceptually Uniform)
  2. `Inferno` (Matplotlib High-Contrast)
  3. `Viridis` (Optimal Dynamic Range)
  4. `Plasma` & `Magma`
  5. `WSJT-X Classic` (Familiar Ham Radio Palette)
  6. `Night Vision Green` & `Amber CRT` (Tactical / Field Palettes)
  7. `High-Contrast B&W` & `Spectral Heatmap`
- **Interactive Carrier Arming**: Double-clicking anywhere on the waterfall calculates the carrier audio frequency, arms TX, and matches the opposite transmit slot automatically.

---

## 📱 Progressive Web App (PWA) & Offline Capability

- **`manifest.json`**: Provides full Android and desktop PWA metadata with standalone fullscreen launch modes and 192px/512px vector icons.
- **`sw.js` (Service Worker)**: Caches application assets, font vectors, and DSP libraries to enable 100% offline field operation without internet access.
