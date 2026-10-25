import { test, expect } from '@playwright/test';
import { callRecordSettings, callRecorder } from '../src/lib/services/callRecorder';
import { CallCanvasCompositor } from '../src/lib/services/callCanvasCompositor';
import { activeCall, resetCallState, patchCallState } from '../src/lib/stores/calls';
import { get } from 'svelte/store';

test.describe('Call recording settings and service', () => {
  test.beforeEach(() => {
    resetCallState();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  test('default recording settings are correctly initialized', () => {
    expect(callRecordSettings.always).toBe(false);
    expect(callRecordSettings.saveVideo).toBe(true);
  });

  test('settings persistence toggles correctly', () => {
    callRecordSettings.always = true;
    expect(callRecordSettings.always).toBe(true);

    callRecordSettings.saveVideo = false;
    expect(callRecordSettings.saveVideo).toBe(false);

    callRecordSettings.always = false;
    expect(callRecordSettings.always).toBe(false);

    callRecordSettings.saveVideo = true;
    expect(callRecordSettings.saveVideo).toBe(true);
  });

  test('activeCall store tracks isRecording state', () => {
    expect(get(activeCall).isRecording).toBe(false);
    patchCallState({ isRecording: true });
    expect(get(activeCall).isRecording).toBe(true);
    patchCallState({ isRecording: false });
    expect(get(activeCall).isRecording).toBe(false);
  });

  test('callRecorder start and stop lifecycle updates state', async () => {
    class SyntheticAudioTrack {
      kind = 'audio';
      id = 'synth_audio_track_1';
      enabled = true;
      readyState = 'live';
      stop() {}
    }

    class SyntheticMediaStream {
      #tracks = [];
      constructor(tracks = []) {
        this.#tracks = tracks;
      }
      getAudioTracks() {
        return this.#tracks.filter(t => t.kind === 'audio');
      }
      getVideoTracks() {
        return this.#tracks.filter(t => t.kind === 'video');
      }
      getTracks() {
        return [...this.#tracks];
      }
    }

    const syntheticLocalStream = new SyntheticMediaStream([new SyntheticAudioTrack()]);
    const syntheticRemoteStream = new SyntheticMediaStream([new SyntheticAudioTrack()]);

    expect(callRecorder.isRecording).toBe(false);

    await callRecorder.start({
      localStream: syntheticLocalStream,
      remoteStreams: [syntheticRemoteStream],
      isVideo: false,
      peerName: 'synthetic_peer',
    });

    expect(callRecorder.isRecording).toBe(true);
    expect(get(activeCall).isRecording).toBe(true);

    await callRecorder.stop('synthetic_peer');

    expect(callRecorder.isRecording).toBe(false);
    expect(get(activeCall).isRecording).toBe(false);
  });

  test('respects saveVideo setting for video call mode', async () => {
    callRecordSettings.saveVideo = false;

    class SyntheticTrack {
      constructor(kind) {
        this.kind = kind;
        this.id = `synth_${kind}_1`;
      }
    }

    class SyntheticMediaStream {
      constructor(tracks = []) {
        this.tracks = tracks;
      }
      getAudioTracks() {
        return this.tracks.filter(t => t.kind === 'audio');
      }
      getVideoTracks() {
        return this.tracks.filter(t => t.kind === 'video');
      }
      getTracks() {
        return [...this.tracks];
      }
    }

    const localStream = new SyntheticMediaStream([new SyntheticTrack('audio')]);

    await callRecorder.start({
      localStream,
      isVideo: true,
      peerName: 'synthetic_peer_video_test',
    });

    expect(callRecorder.isRecording).toBe(true);
    await callRecorder.stop('synthetic_peer_video_test');
    expect(callRecorder.isRecording).toBe(false);

    callRecordSettings.saveVideo = true;
  });

  test('audio-only call records without video tracks when alwaysSaveVideo is false', async () => {
    callRecordSettings.alwaysSaveVideo = false;
    callRecordSettings.saveVideo = true;

    class SyntheticTrack {
      constructor(kind) {
        this.kind = kind;
        this.id = `synth_${kind}_test`;
      }
    }

    class SyntheticMediaStream {
      constructor(tracks = []) {
        this.tracks = tracks;
      }
      getAudioTracks() {
        return this.tracks.filter(t => t.kind === 'audio');
      }
      getVideoTracks() {
        return this.tracks.filter(t => t.kind === 'video');
      }
      getTracks() {
        return [...this.tracks];
      }
    }

    const localStream = new SyntheticMediaStream([new SyntheticTrack('audio')]);

    await callRecorder.start({
      localStream,
      isVideo: false,
      peerName: 'synthetic_audio_call_test',
      participants: [
        {
          id: 'synth_p1',
          name: 'Synthetic Peer',
          avatar: null,
          hasVideo: false,
          stream: null,
        },
      ],
    });

    expect(callRecorder.isRecording).toBe(true);
    await callRecorder.stop('synthetic_audio_call_test');
    expect(callRecorder.isRecording).toBe(false);
  });

  test('CallCanvasCompositor initializes and updates state with synthetic participants', () => {
    const compositor = new CallCanvasCompositor();
    expect(compositor.hasAnyVideo).toBe(false);

    const syntheticParticipants = [
      {
        id: 'synth_user_1',
        name: 'Synthetic Alice',
        avatar: null,
        hasVideo: false,
        stream: null,
        isMuted: false,
        isSpeaking: false,
      },
      {
        id: 'synth_user_2',
        name: 'Synthetic Bob',
        avatar: null,
        hasVideo: true,
        stream: null,
        isMuted: true,
        isSpeaking: true,
      },
    ];

    compositor.updateState({
      participants: syntheticParticipants,
      screenStream: null,
      isScreenSharing: false,
      hasAnyVideo: true,
    });

    expect(compositor.hasAnyVideo).toBe(true);
    compositor.stop();
  });
});
