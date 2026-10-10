#!/usr/bin/env python3
"""WEB-формат опкода 19 в rumax sync(): без userAgent/exp/configHash. Запуск: python3 tools/apply_qr_sync.py"""
import os
p = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "rumax", "src", "api", "auth.rs"))
s = open(p, encoding="utf-8").read()
I = " " * 8
old_payload = (I + 'let mut payload = json!({\n'
    + I + '    "userAgent": identity.user_agent,\n' + I + '    "interactive": true,\n' + I + '    "token": token,\n'
    + I + '    "chatsSync": sync_state.chats_sync,\n' + I + '    "contactsSync": sync_state.contacts_sync,\n'
    + I + '    "presenceSync": sync_state.presence_sync,\n' + I + '    "draftsSync": sync_state.drafts_sync,\n'
    + I + '    "exp": {\n' + I + '        "chatsCountGroups": vec![0x0a, 0x32]\n' + I + '    }\n' + I + '});\n')
old_hash = (I + 'if let Some(hash) = &sync_state.config_hash {\n' + I + '    payload["configHash"] = hash.clone();\n'
    + I + '} else {\n' + I + '    payload["configHash"] = json!(DEFAULT_CONFIG_HASH);\n' + I + '}\n')
if '"chatsCount": 40' in s:
    print("Уже применено"); raise SystemExit
if old_payload not in s or old_hash not in s:
    print("!! Блок payload/configHash не найден — ничего не изменено"); raise SystemExit(1)
mobile = "\n".join("    " + l if l else l for l in old_payload.replace("let mut payload = ", "").rstrip("\n").rstrip(";").split("\n"))
new_payload = (I + "let mut payload = if is_web {\n" + I + "    json!({\n"
    + I + '        "token": token,\n' + I + '        "chatsCount": 40,\n' + I + '        "interactive": true,\n'
    + I + '        "chatsSync": sync_state.chats_sync,\n' + I + '        "contactsSync": sync_state.contacts_sync,\n'
    + I + '        "presenceSync": sync_state.presence_sync,\n' + I + '        "draftsSync": sync_state.drafts_sync,\n'
    + I + "    })\n" + I + "} else {\n" + mobile + "\n" + I + "};\n")
new_hash = I + "if !is_web {\n" + "".join("    " + l + "\n" for l in old_hash.rstrip("\n").split("\n")) + I + "}\n"
s = s.replace(old_payload, new_payload, 1).replace(old_hash, new_hash, 1)
open(p, "w", encoding="utf-8").write(s)
print("rumax sync(): WEB-формат опкода 19, configHash только для мобильного")
