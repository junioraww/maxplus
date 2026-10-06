import sys
import json
import time
import queue
import argparse
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstWebRTC', '1.0')
gi.require_version('GstSdp', '1.0')
from gi.repository import Gst, GstWebRTC, GstSdp, GLib

Gst.init(None)

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class WebRTCSession:
    def __init__(self):
        self.pipeline = None
        self.webrtc = None
        self.audio_src = None
        self.video_src = None
        self.candidates = []
        self.cand_lock = threading.Lock()
        self.frame_queue = queue.Queue(maxsize=2)
        self.has_remote_video = False
        self.has_remote_audio = False
        self.connection_state = 'new'
        self.ice_state = 'new'
        self.glib_loop = GLib.MainLoop()
        self.loop_thread = threading.Thread(target=self.glib_loop.run, daemon=True)
        self.loop_thread.start()

    def create(self, ice_servers, is_audio=True, is_video=False):
        self.close()
        self.candidates = []
        self.has_remote_video = False
        self.has_remote_audio = False
        self.connection_state = 'connecting'
        self.ice_state = 'checking'

        pipe = Gst.Pipeline.new('webrtc_pipeline')
        wb = Gst.ElementFactory.make('webrtcbin', 'wb')
        wb.set_property('bundle-policy', 3)
        pipe.add(wb)

        for s in ice_servers:
            urls = s.get('urls') or s.get('url') or []
            if isinstance(urls, str):
                urls = [urls]
            for u in urls:
                if u.startswith('stun:'):
                    wb.set_property('stun-server', u.replace('stun:', 'stun://'))
                elif u.startswith('turn:') or u.startswith('turns:'):
                    wb.emit('add-turn-server', u)

        if is_audio:
            asrc = Gst.ElementFactory.make('autoaudiosrc', 'asrc')
            aconv = Gst.ElementFactory.make('audioconvert', 'aconv')
            aresample = Gst.ElementFactory.make('audioresample', 'aresample')
            aenc = Gst.ElementFactory.make('opusenc', 'aenc')
            apay = Gst.ElementFactory.make('rtpopuspay', 'apay')
            aqueue = Gst.ElementFactory.make('queue', 'aqueue')
            pipe.add(asrc)
            pipe.add(aconv)
            pipe.add(aresample)
            pipe.add(aenc)
            pipe.add(apay)
            pipe.add(aqueue)
            asrc.link(aconv)
            aconv.link(aresample)
            aresample.link(aenc)
            aenc.link(apay)
            apay.link(aqueue)
            aqueue.link(wb)
            self.audio_src = asrc
        else:
            acaps = Gst.Caps.from_string('application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000')
            wb.emit('add-transceiver', GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY, acaps)

        if is_video:
            vsrc = Gst.ElementFactory.make('v4l2src', 'vsrc')
            if not vsrc or not vsrc.get_property('device'):
                vsrc = Gst.ElementFactory.make('videotestsrc', 'vsrc')
                if vsrc:
                    vsrc.set_property('is-live', True)
            vconv = Gst.ElementFactory.make('videoconvert', 'vconv')
            vscale = Gst.ElementFactory.make('videoscale', 'vscale')
            capsfilter = Gst.ElementFactory.make('capsfilter', 'vcaps')
            capsfilter.set_property('caps', Gst.Caps.from_string('video/x-raw,width=640,height=480,framerate=30/1'))
            venc = Gst.ElementFactory.make('vp8enc', 'venc')
            if venc:
                venc.set_property('deadline', 1)
                venc.set_property('cpu-used', 4)
            vpay = Gst.ElementFactory.make('rtpvp8pay', 'vpay')
            vqueue = Gst.ElementFactory.make('queue', 'vqueue')
            pipe.add(vsrc)
            pipe.add(vconv)
            pipe.add(vscale)
            pipe.add(capsfilter)
            pipe.add(venc)
            pipe.add(vpay)
            pipe.add(vqueue)
            vsrc.link(vconv)
            vconv.link(vscale)
            vscale.link(capsfilter)
            capsfilter.link(venc)
            venc.link(vpay)
            vpay.link(vqueue)
            vqueue.link(wb)
            self.video_src = vsrc
        else:
            vcaps = Gst.Caps.from_string('application/x-rtp,media=video,encoding-name=VP8,clock-rate=90000')
            wb.emit('add-transceiver', GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY, vcaps)

        wb.connect('on-ice-candidate', self._on_ice_candidate)
        wb.connect('pad-added', self._on_pad_added)
        wb.connect('notify::connection-state', self._on_connection_state_change)
        wb.connect('notify::ice-connection-state', self._on_ice_state_change)

        pipe.set_state(Gst.State.PLAYING)
        self.pipeline = pipe
        self.webrtc = wb

    def _on_ice_candidate(self, element, mline, cand):
        with self.cand_lock:
            self.candidates.append({
                'candidate': cand,
                'sdpMLineIndex': mline,
                'sdpMid': str(mline)
            })

    def _on_connection_state_change(self, wb, pspec):
        st = wb.get_property('connection-state')
        states = {0: 'new', 1: 'connecting', 2: 'connected', 3: 'disconnected', 4: 'failed', 5: 'closed'}
        self.connection_state = states.get(int(st), 'unknown')

    def _on_ice_state_change(self, wb, pspec):
        st = wb.get_property('ice-connection-state')
        states = {0: 'new', 1: 'checking', 2: 'connected', 3: 'completed', 4: 'failed', 5: 'disconnected', 6: 'closed'}
        self.ice_state = states.get(int(st), 'unknown')

    def _on_pad_added(self, wb, pad):
        if pad.direction != Gst.PadDirection.SRC:
            return
        caps = pad.get_current_caps() or pad.query_caps(None)
        if not caps or caps.get_size() == 0:
            return
        st = caps.get_structure(0)
        media = st.get_string('media')
        if media == 'audio':
            self.has_remote_audio = True
            depay = Gst.ElementFactory.make('rtpopusdepay', None)
            dec = Gst.ElementFactory.make('opusdec', None)
            conv = Gst.ElementFactory.make('audioconvert', None)
            resample = Gst.ElementFactory.make('audioresample', None)
            sink = Gst.ElementFactory.make('autoaudiosink', None)
            self.pipeline.add(depay)
            self.pipeline.add(dec)
            self.pipeline.add(conv)
            self.pipeline.add(resample)
            self.pipeline.add(sink)
            depay.link(dec)
            dec.link(conv)
            conv.link(resample)
            resample.link(sink)
            depay.sync_state_with_parent()
            dec.sync_state_with_parent()
            conv.sync_state_with_parent()
            resample.sync_state_with_parent()
            sink.sync_state_with_parent()
            pad.link(depay.get_static_pad('sink'))
        elif media == 'video':
            self.has_remote_video = True
            depay = Gst.ElementFactory.make('rtpvp8depay', None)
            dec = Gst.ElementFactory.make('vp8dec', None)
            conv = Gst.ElementFactory.make('videoconvert', None)
            scale = Gst.ElementFactory.make('videoscale', None)
            cfilter = Gst.ElementFactory.make('capsfilter', None)
            cfilter.set_property('caps', Gst.Caps.from_string('video/x-raw,format=BGR'))
            jenc = Gst.ElementFactory.make('jpegenc', None)
            if jenc:
                jenc.set_property('quality', 80)
            sink = Gst.ElementFactory.make('appsink', 'videosink')
            sink.set_property('emit-signals', True)
            sink.set_property('max-buffers', 1)
            sink.set_property('drop', True)
            sink.connect('new-sample', self._on_new_video_sample)
            self.pipeline.add(depay)
            self.pipeline.add(dec)
            self.pipeline.add(conv)
            self.pipeline.add(scale)
            self.pipeline.add(cfilter)
            self.pipeline.add(jenc)
            self.pipeline.add(sink)
            depay.link(dec)
            dec.link(conv)
            conv.link(scale)
            scale.link(cfilter)
            cfilter.link(jenc)
            jenc.link(sink)
            depay.sync_state_with_parent()
            dec.sync_state_with_parent()
            conv.sync_state_with_parent()
            scale.sync_state_with_parent()
            cfilter.sync_state_with_parent()
            jenc.sync_state_with_parent()
            sink.sync_state_with_parent()
            pad.link(depay.get_static_pad('sink'))

    def _on_new_video_sample(self, sink):
        sample = sink.emit('pull-sample')
        if not sample:
            return Gst.FlowReturn.OK
        buf = sample.get_buffer()
        res, mapinfo = buf.map(Gst.MapFlags.READ)
        if res:
            try:
                data = bytes(mapinfo.data)
                if self.frame_queue.full():
                    try:
                        self.frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.frame_queue.put(data)
            finally:
                buf.unmap(mapinfo)
        return Gst.FlowReturn.OK

    def create_offer(self):
        result = {'sdp': None, 'error': None}
        ev = threading.Event()

        def on_offer(promise, _):
            reply = promise.get_reply()
            offer = reply.get_value('offer')
            if offer:
                p2 = Gst.Promise.new()
                self.webrtc.emit('set-local-description', offer, p2)
                result['sdp'] = offer.sdp.as_text()
            else:
                result['error'] = 'No offer produced'
            ev.set()

        def do_create():
            promise = Gst.Promise.new_with_change_func(on_offer, None)
            self.webrtc.emit('create-offer', None, promise)

        GLib.idle_add(do_create)
        ev.wait(timeout=5.0)
        return result

    def set_remote_description(self, sdp_type, sdp_text):
        result = {'answer': None, 'error': None}
        ev = threading.Event()

        def on_answer_created(promise, _):
            reply = promise.get_reply()
            answer = reply.get_value('answer')
            if answer:
                p2 = Gst.Promise.new()
                self.webrtc.emit('set-local-description', answer, p2)
                result['answer'] = answer.sdp.as_text()
            else:
                result['error'] = 'Failed to create answer'
            ev.set()

        def on_remote_set(promise, _):
            if sdp_type.lower() == 'offer':
                p_ans = Gst.Promise.new_with_change_func(on_answer_created, None)
                self.webrtc.emit('create-answer', None, p_ans)
            else:
                ev.set()

        def do_set():
            res, sdp = GstSdp.SDPMessage.new()
            res = GstSdp.sdp_message_parse_buffer(bytes(sdp_text, 'utf-8'), sdp)
            if res != GstSdp.SDPResult.OK:
                result['error'] = 'Failed to parse remote SDP'
                ev.set()
                return
            t = GstWebRTC.WebRTCSDPType.OFFER if sdp_type.lower() == 'offer' else GstWebRTC.WebRTCSDPType.ANSWER
            desc = GstWebRTC.WebRTCSessionDescription.new(t, sdp)
            promise = Gst.Promise.new_with_change_func(on_remote_set, None)
            self.webrtc.emit('set-remote-description', desc, promise)

        GLib.idle_add(do_set)
        ev.wait(timeout=5.0)
        return result

    def add_ice_candidate(self, mline, cand_str):
        if not self.webrtc:
            return
        def do_add():
            self.webrtc.emit('add-ice-candidate', int(mline), cand_str)
        GLib.idle_add(do_add)

    def get_candidates(self):
        with self.cand_lock:
            cands = list(self.candidates)
            self.candidates = []
            return cands

    def close(self):
        if self.pipeline:
            pipe = self.pipeline
            self.pipeline = None
            self.webrtc = None
            def do_stop():
                pipe.set_state(Gst.State.NULL)
            GLib.idle_add(do_stop)
        self.connection_state = 'closed'
        self.ice_state = 'closed'

SESSION = WebRTCSession()

class RequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        path = self.path.split('?')[0]
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            req = json.loads(post_data.decode('utf-8'))
        except Exception:
            req = {}

        if path == '/create':
            ice_servers = req.get('iceServers', [])
            is_audio = req.get('isAudio', True)
            is_video = req.get('isVideo', False)
            SESSION.create(ice_servers, is_audio, is_video)
            self._send_json({'status': 'ok'})
        elif path == '/create_offer':
            res = SESSION.create_offer()
            if res.get('sdp'):
                self._send_json({'type': 'offer', 'sdp': res['sdp']})
            else:
                self._send_json({'error': res.get('error') or 'Failed'}, status=500)
        elif path == '/set_remote_description':
            sdp_type = req.get('type', 'answer')
            sdp_text = req.get('sdp', '')
            res = SESSION.set_remote_description(sdp_type, sdp_text)
            if sdp_type.lower() == 'offer':
                if res.get('answer'):
                    self._send_json({'type': 'answer', 'sdp': res['answer']})
                else:
                    self._send_json({'error': res.get('error') or 'Failed'}, status=500)
            else:
                self._send_json({'status': 'ok'})
        elif path == '/add_ice_candidate':
            mline = req.get('sdpMLineIndex', 0)
            cand = req.get('candidate', '')
            if cand:
                SESSION.add_ice_candidate(mline, cand)
            self._send_json({'status': 'ok'})
        elif path == '/close':
            SESSION.close()
            self._send_json({'status': 'ok'})
        else:
            self._send_json({'error': 'Not found'}, status=404)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/candidates':
            cands = SESSION.get_candidates()
            self._send_json({'candidates': cands})
        elif path == '/status':
            self._send_json({
                'connectionState': SESSION.connection_state,
                'iceConnectionState': SESSION.ice_state,
                'hasRemoteVideo': SESSION.has_remote_video,
                'hasRemoteAudio': SESSION.has_remote_audio,
            })
        elif path == '/video_stream':
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            while SESSION.pipeline is not None:
                try:
                    frame = SESSION.frame_queue.get(timeout=1.0)
                    part = b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + str(len(frame)).encode('ascii') + b'\r\n\r\n' + frame + b'\r\n'
                    self.wfile.write(part)
                    self.wfile.flush()
                except queue.Empty:
                    continue
                except Exception:
                    break
        else:
            self._send_json({'error': 'Not found'}, status=404)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=14230)
    args = parser.parse_args()

    server = ThreadedHTTPServer(('127.0.0.1', args.port), RequestHandler)
    server.serve_forever()

if __name__ == '__main__':
    main()
