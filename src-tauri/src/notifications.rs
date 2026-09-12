#[cfg(target_os = "android")]
use jni::{
    objects::{JObject, JString},
    sys::jboolean,
    EnvUnowned,
};
#[cfg(target_os = "android")]
use std::{collections::HashMap, time::Duration};
#[cfg(target_os = "android")]
use serde_json::json;
#[cfg(target_os = "android")]
use tokio::{runtime::Runtime, time::timeout};

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_ReplyReceiver_sendReplyNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i32,
    chat_id: i64,
    mid: i64,
    text: JString<'local>,
    app_dir: JString<'local>,
) -> jboolean {
    let (rust_text, rust_app_dir) =
        match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
            Ok((
                text.to_string(),
                app_dir.to_string(),
            ))
        }).into_outcome() {
            jni::Outcome::Ok(v) => v,
            _ => return false,
        };

    let rt = Runtime::new().unwrap();

    let success = rt.block_on(async {
        let user_id = account as u64;

        if let Some((token, identity)) =
            crate::stores::get_background_creds(&rust_app_dir, user_id)
            {
                let network_task = async {
                    let mut client = rumax::MaxClient::new();

                    client.set_user_id(user_id).await;
                    client.set_token(token).await;

                    if client.connect(identity, false).await.is_ok() {
                        let mut params = None;

                        if mid != 0 {
                            let mut map = HashMap::new();
                            map.insert("reply_to".to_string(), json!(mid));
                            params = Some(map);
                        }

                        let send_result = client.send_message(chat_id, rust_text, params).await;

                        client.disconnect().await;

                        return send_result.is_ok();
                    }

                    false
                };

                match timeout(Duration::from_secs(8), network_task).await {
                    Ok(result) => result,
                    Err(_) => false,
                }
            } else {
                false
            }
    });

    success
}
