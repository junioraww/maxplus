#!/usr/bin/env python3
"""QR-вход: правки rumax + перевод maxplus на команды request_qr/check_qr/login_by_qr.
Запуск: python3 tools/apply_qr_login.py   (из корня maxplus). Повторный запуск безопасен."""
import re, os
M = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.normpath(os.path.join(M, "..", "rumax"))
log = []
def rd(p): return open(p, encoding="utf-8").read()
def wr(p, s): open(p, "w", encoding="utf-8").write(s)
def brace_end(s, i):
    d = 0
    for j in range(i, len(s)):
        if s[j] == "{": d += 1
        elif s[j] == "}":
            d -= 1
            if d == 0: return j
    return -1

# ---- rumax: src/api/auth.rs ----
p = R + "/src/api/auth.rs"; s = rd(p)
if "fn request_qr" not in s:
    i = s.index("pub async fn resend_auth"); b = s.index("{", i); e = brace_end(s, b)
    s = s[:e+1] + '''

    pub async fn request_qr(&self) -> ClientResult<Response> {
        self.send_and_wait(288, json!({}), 0).await
    }

    pub async fn check_qr(&self, track_id: String) -> ClientResult<Response> {
        self.send_and_wait(289, json!({ "trackId": track_id }), 0).await
    }

    pub async fn login_by_qr(&self, track_id: String) -> ClientResult<Response> {
        let resp = self.send_and_wait(291, json!({ "trackId": track_id }), 0).await?;
        if let Some(t) = resp.payload.pointer("/tokenAttrs/LOGIN/token").and_then(|t| t.as_str()) {
            self.set_token(t.to_string()).await;
        }
        Ok(resp)
    }''' + s[e+1:]
    log.append("rumax auth.rs: request_qr/check_qr/login_by_qr")
si = s.index("pub async fn sync("); sb = s.index("{", s.index(")", si)); se = brace_end(s, sb); body = s[sb:se]
if "is_web" not in body:
    k = body.find("let mut payload = json!(")
    ua = re.search(r"(\w+)\.user_agent", body)
    if k < 0 or not ua:
        log.append("!! sync(): payload/identity не найдены — правьте вручную")
    else:
        jb = body.index("{", k); je = brace_end(body, jb); end = body.index(";", je)
        orig = body[body.index("json!(", k):end]; ind = body[body.rfind("\n", 0, k)+1:k]; v = ua.group(1)
        new = (f'let is_web = {v}.user_agent.device_type.eq_ignore_ascii_case("web");\n{ind}let mut payload = if is_web {{\n{ind}    json!({{\n'
               f'{ind}        "token": token, "chatsCount": 40, "interactive": true,\n'
               f'{ind}        "chatsSync": sync_state.chats_sync, "contactsSync": sync_state.contacts_sync,\n'
               f'{ind}        "presenceSync": sync_state.presence_sync, "draftsSync": sync_state.drafts_sync,\n'
               f'{ind}    }})\n{ind}}} else {{\n{ind}    {orig}\n{ind}}}')
        body = body[:k] + new + body[end:]
        c = body.find('payload["configHash"]')
        if c >= 0:
            ls = body.rfind("\n", 0, c)+1; ce = body.index(";", c)+1; st = body[ls:ce]; ci = st[:len(st)-len(st.lstrip())]
            body = body[:ls] + ci + "if !is_web {\n    " + st + "\n" + ci + "}" + body[ce:]
            log.append("rumax sync(): configHash только для мобильного")
        s = s[:sb] + body + s[se:]; log.append("rumax sync(): WEB-формат опкода 19")
wr(p, s)

# ---- rumax: src/models/common.rs ----
p = R + "/src/models/common.rs"; s = rd(p)
if "to_web_payload" not in s:
    wr(p, s + '''
impl UserAgent {
    pub fn to_web_payload(&self) -> serde_json::Value {
        let mut v = serde_json::to_value(self).unwrap_or_default();
        if let Some(m) = v.as_object_mut() {
            m.retain(|k, _| matches!(k.as_str(),
                "deviceType" | "locale" | "deviceLocale" | "osVersion" | "deviceName" |
                "headerUserAgent" | "appVersion" | "screen" | "timezone"));
            m.entry("headerUserAgent").or_insert(serde_json::json!(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"));
        }
        v
    }
}
'''); log.append("rumax common.rs: UserAgent::to_web_payload")

# ---- rumax: src/lib.rs (handshake) ----
p = R + "/src/lib.rs"; s = rd(p)
if "to_web_payload" not in s:
    h = s.index("let handshake_payload = if is_mobile"); el = s.index("} else {", h)
    t = '"userAgent": identity.user_agent,'; k = s.find(t, el)
    if 0 <= k - el < 300:
        wr(p, s[:k] + '"userAgent": identity.user_agent.to_web_payload(),' + s[k+len(t):]); log.append("rumax lib.rs: WEB handshake → to_web_payload")
    else: log.append("!! rumax lib.rs: userAgent в else-ветке не найден")

# ---- maxplus: Tauri-команды ----
p = M + "/src-tauri/src/commands.rs"; s = rd(p)
if "request_qr" not in s:
    a = "delegate_cmd!(resend_auth(phone: String) => resend_auth(phone));\n"
    s = s.replace(a, a + "delegate_cmd!(request_qr() => request_qr());\ndelegate_cmd!(check_qr(track_id: String) => check_qr(track_id));\ndelegate_cmd!(login_by_qr(track_id: String) => login_by_qr(track_id));\n", 1)
    wr(p, s); log.append("maxplus commands.rs: request_qr/check_qr/login_by_qr")
p = M + "/src-tauri/src/lib.rs"; s = rd(p)
if "commands::request_qr" not in s:
    s, n = re.subn(r"(commands::resend_auth,)", r"\1 commands::request_qr, commands::check_qr, commands::login_by_qr,", s, 1)
    wr(p, s); log.append(f"maxplus lib.rs: generate_handler ({n})")

# ---- maxplus: страница QR на новые команды ----
p = M + "/src/routes/auth/qr/+page.svelte"; s = rd(p)
if "await op(" in s:
    s = re.sub(r"  // Опкоды:.*?\n  const op = async[\s\S]*?\n  \};\n", '''  // 288 GET_QR, 289 GET_QR_STATUS, 291 LOGIN_BY_QR
  const unwrap = (r) => {
    const p = r?.payload ?? r;
    if (p?.error) throw p;
    return p;
  };
''', s, 1)
    s = (s.replace("await op(288, {})", 'unwrap(await invoke("request_qr"))')
          .replace("await op(289, { trackId: r.trackId })", 'unwrap(await invoke("check_qr", { trackId: r.trackId }))')
          .replace("await op(291, { trackId })", 'unwrap(await invoke("login_by_qr", { trackId }))'))
    s = re.sub(r'  import \{\s*getAccounts,[\s\S]*?\} from "\$lib/stores/accounts";\n', "", s)
    s = re.sub(r"import \{\s*get as sessionGet,\s*set as sessionSet,\s*\}", "import { set as sessionSet }", s)
    s = re.sub(r"import API, \{\s*currentUser\s*\}", "import API", s)
    wr(p, s); log.append("maxplus auth/qr: переведена на invoke(request_qr/check_qr/login_by_qr)")

print("\n".join(log) or "Всё уже применено")
