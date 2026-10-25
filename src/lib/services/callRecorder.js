import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { showAlert } from '$lib/utils/alert';
import { patchCallState } from '$lib/stores/calls';
import { CallCanvasCompositor } from '$lib/services/callCanvasCompositor';

const memStorage = new Map();

function getStorage(key, fallback = null) {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key);
      return v !== null ? v : fallback;
    }
  } catch {}
  return memStorage.has(key) ? memStorage.get(key) : fallback;
}

function setStorage(key, val) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
    }
  } catch {}
  memStorage.set(key, val);
}

export const callRecordSettings = {
  get always() {
    return getStorage('maxplus_always_record_calls', 'false') === 'true';
  },
  set always(val) {
    setStorage('maxplus_always_record_calls', val ? 'true' : 'false');
  },
  get saveVideo() {
    return getStorage('maxplus_record_video_calls', 'true') !== 'false';
  },
  set saveVideo(val) {
    setStorage('maxplus_record_video_calls', val ? 'true' : 'false');
  },
  get alwaysSaveVideo() {
    return getStorage('maxplus_always_save_video_calls', 'false') === 'true';
  },
  set alwaysSaveVideo(val) {
    setStorage('maxplus_always_save_video_calls', val ? 'true' : 'false');
  },
};

class CallRecorderService {
  #recorder = null;
  #audioCtx = null;
  #audioDest = null;
  #attachedStreams = new Set();
  #compositor = null;
  #tempPath = null;
  #startTime = 0;
  #isVideoEnabled = false;
  #isRecording = false;

  get isRecording() {
    return this.#isRecording;
  }

  attachStream(stream) {
    if (!this.#isRecording || !this.#audioCtx || !this.#audioDest || !stream) return;
    if (this.#attachedStreams.has(stream)) return;
    if (stream.getAudioTracks && stream.getAudioTracks().length > 0) {
      try {
        const srcNode = this.#audioCtx.createMediaStreamSource(stream);
        srcNode.connect(this.#audioDest);
        this.#attachedStreams.add(stream);
      } catch {}
    }
  }

  updateParticipants(state) {
    if (!this.#isRecording) return;
    if (this.#compositor) {
      this.#compositor.updateState(state);
    }
    if (state.remoteStream) {
      this.attachStream(state.remoteStream);
    }
    if (Array.isArray(state.participants)) {
      for (const p of state.participants) {
        if (p.stream) this.attachStream(p.stream);
      }
    }
  }

  async start({
    localStream = null,
    remoteStreams = [],
    isVideo = false,
    peerName = 'call',
    participants = [],
    screenStream = null,
    isScreenSharing = false,
  }) {
    if (this.#isRecording) return;
    const shouldRecordVideo = Boolean(callRecordSettings.saveVideo);
    this.#isVideoEnabled = shouldRecordVideo;
    this.#startTime = Date.now();

    try {
      const AudioContextClass = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : (globalThis.AudioContext || globalThis.webkitAudioContext);

      let tracks = [];

      if (AudioContextClass) {
        this.#audioCtx = new AudioContextClass();
        if (this.#audioCtx.state === 'suspended') {
          await this.#audioCtx.resume().catch(() => {});
        }

        const dest = this.#audioCtx.createMediaStreamDestination ? this.#audioCtx.createMediaStreamDestination() : null;
        this.#audioDest = dest;
        this.#attachedStreams.clear();
        const sourcesToAttach = [localStream, ...remoteStreams].filter(Boolean);

        if (dest) {
          for (const s of sourcesToAttach) {
            if (s && s.getAudioTracks && s.getAudioTracks().length > 0) {
              try {
                const srcNode = this.#audioCtx.createMediaStreamSource(s);
                srcNode.connect(dest);
                this.#attachedStreams.add(s);
              } catch {}
            }
          }

          if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
            try {
              const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
              const monitorDev = devices.find(d => d.kind === 'audioinput' && /\.monitor|monitor/i.test(d.label || ''));
              if (monitorDev?.deviceId) {
                const monStream = await navigator.mediaDevices.getUserMedia({
                  audio: { deviceId: { exact: monitorDev.deviceId } }
                }).catch(() => null);
                if (monStream && monStream.getAudioTracks().length > 0) {
                  const monSource = this.#audioCtx.createMediaStreamSource(monStream);
                  monSource.connect(dest);
                }
              }
            } catch {}
          }

          tracks = dest.stream?.getAudioTracks ? [...dest.stream.getAudioTracks()] : [];
        }
      }

      if (tracks.length === 0) {
        const sourcesToAttach = [localStream, ...remoteStreams].filter(Boolean);
        for (const s of sourcesToAttach) {
          if (s && s.getAudioTracks) {
            tracks.push(...s.getAudioTracks());
          }
        }
      }

      if (tracks.length === 0 && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          let audioConstraint = { audio: true };
          if (navigator.mediaDevices.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
            const physicalMic = devices.find(d => d.kind === 'audioinput' && !/virtual|audiorelay/i.test(d.label || ''));
            if (physicalMic?.deviceId) {
              audioConstraint = { audio: { deviceId: { exact: physicalMic.deviceId } } };
            }
          }
          const mic = await navigator.mediaDevices.getUserMedia(audioConstraint).catch(() => null);
          if (mic && mic.getAudioTracks().length > 0) {
            tracks.push(...mic.getAudioTracks());
          }
        } catch {}
      }

      if (this.#isVideoEnabled && typeof document !== 'undefined') {
        this.#compositor = new CallCanvasCompositor();
        this.#compositor.updateState({
          participants,
          screenStream,
          isScreenSharing,
          hasAnyVideo: Boolean(isVideo || isScreenSharing || participants.some(p => p.hasVideo)),
        });
        this.#compositor.start();

        const canvasStream = this.#compositor.getCaptureStream(25);
        const vTrack = canvasStream?.getVideoTracks ? canvasStream.getVideoTracks()[0] : null;
        if (vTrack) tracks.unshift(vTrack);
      }

      const MediaRecorderClass = typeof window !== 'undefined'
        ? window.MediaRecorder
        : globalThis.MediaRecorder;

      const baseDir = await appDataDir().catch(() => '');
      const cleanPeer = String(peerName || 'call').replace(/[^\w\d-_]/g, '_');
      const filename = `rec_${cleanPeer}_${Date.now()}.webm`;
      this.#tempPath = baseDir ? await join(baseDir, 'data', 'recordings', filename).catch(() => filename) : filename;

      if (MediaRecorderClass) {
        const hasVideoTrack = tracks.some(t => t.kind === 'video');
        const mimeType = this.#resolveMimeType(hasVideoTrack);
        const combinedStream = typeof MediaStream !== 'undefined' ? new MediaStream(tracks) : { getTracks: () => tracks };
        this.#recorder = new MediaRecorderClass(combinedStream, mimeType ? { mimeType } : {});

        this.#recorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0 && this.#tempPath) {
            try {
              const buf = await e.data.arrayBuffer();
              await invoke('append_file_bytes', {
                path: this.#tempPath,
                content: Array.from(new Uint8Array(buf)),
              });
            } catch {}
          }
        };

        if (typeof this.#recorder.start === 'function') {
          this.#recorder.start(1000);
        }
      }

      this.#isRecording = true;
      patchCallState({ isRecording: true });
    } catch {
      this.#cleanup();
    }
  }

  async stop(peerName = 'call', targetPath = null) {
    if (!this.#isRecording) return;
    this.#isRecording = false;
    patchCallState({ isRecording: false });

    const durationSec = Math.max(0.1, (Date.now() - this.#startTime) / 1000);
    const hasAnyVideo = Boolean(this.#compositor?.hasAnyVideo && this.#isVideoEnabled);
    const saveAsVideo = hasAnyVideo || (callRecordSettings.alwaysSaveVideo && this.#isVideoEnabled);

    if (this.#compositor) {
      this.#compositor.stop();
      this.#compositor = null;
    }

    if (this.#recorder && this.#recorder.state !== 'inactive' && typeof this.#recorder.stop === 'function') {
      await new Promise((resolve) => {
        this.#recorder.onstop = () => resolve();
        try {
          this.#recorder.stop();
        } catch {
          resolve();
        }
        setTimeout(resolve, 500);
      });
    }

    if (this.#audioCtx) {
      this.#audioCtx.close().catch(() => {});
      this.#audioCtx = null;
    }
    this.#audioDest = null;
    this.#attachedStreams.clear();

    const temp = this.#tempPath;
    this.#tempPath = null;
    this.#recorder = null;

    if (!temp) return;

    const cleanPeer = String(peerName || 'call').replace(/[^\w\d-_]/g, '_');
    const defaultName = saveAsVideo
      ? `call_${cleanPeer}_${Date.now()}.webm`
      : `audio_${cleanPeer}_${Date.now()}.ogg`;

    try {
      await invoke('finalize_call_recording', {
        tempPath: temp,
        name: defaultName,
        targetPath: targetPath || null,
        durationSec,
      });
      showAlert('Запись звонка сохранена');
    } catch {
      try {
        await invoke('download', { url: temp, name: defaultName });
        showAlert('Запись звонка сохранена');
      } catch {}
    }
  }

  #cleanup() {
    this.#isRecording = false;
    patchCallState({ isRecording: false });
    if (this.#compositor) {
      this.#compositor.stop();
      this.#compositor = null;
    }
    if (this.#audioCtx) {
      this.#audioCtx.close().catch(() => {});
      this.#audioCtx = null;
    }
    this.#audioDest = null;
    this.#attachedStreams.clear();
    this.#recorder = null;
    this.#tempPath = null;
  }

  #resolveMimeType(hasVideo) {
    const MediaRecorderClass = typeof window !== 'undefined' ? window.MediaRecorder : globalThis.MediaRecorder;
    if (!MediaRecorderClass || typeof MediaRecorderClass.isTypeSupported !== 'function') return '';
    if (hasVideo) {
      if (MediaRecorderClass.isTypeSupported('video/webm;codecs=vp8,opus')) return 'video/webm;codecs=vp8,opus';
      if (MediaRecorderClass.isTypeSupported('video/webm')) return 'video/webm';
      if (MediaRecorderClass.isTypeSupported('video/mp4')) return 'video/mp4';
    } else {
      if (MediaRecorderClass.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
      if (MediaRecorderClass.isTypeSupported('audio/webm')) return 'audio/webm';
      if (MediaRecorderClass.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
    }
    return '';
  }
}

export const callRecorder = new CallRecorderService();
