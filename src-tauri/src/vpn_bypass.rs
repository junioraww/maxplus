pub fn is_vpn_detected() -> bool {
    #[cfg(target_os = "android")]
    {
        jni_call_check_vpn().unwrap_or(false)
    }
    #[cfg(not(target_os = "android"))]
    {
        false
    }
}

pub fn apply_physical_network_route() -> bool {
    #[cfg(target_os = "android")]
    {
        jni_call_route_physical().unwrap_or(false)
    }
    #[cfg(not(target_os = "android"))]
    {
        false
    }
}

pub fn reset_physical_network_route() -> bool {
    #[cfg(target_os = "android")]
    {
        jni_call_detach_route().unwrap_or(true)
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

#[cfg(target_os = "android")]
fn jni_call_check_vpn() -> Option<bool> {
    let vm = crate::notifications::GLOBAL_JVM.get()?;
    vm.attach_current_thread(|env| -> Result<bool, jni::errors::Error> {
        let main_class = env
            .find_class(jni::jni_str!("me/junioraww/max/MainActivity"))?;
        let res = env
            .call_static_method(
                main_class,
                jni::jni_str!("checkVpnTunnelState"),
                jni::jni_sig!("()Z"),
                &[],
            )?
            .z()?;
        Ok(res)
    })
    .ok()
}

#[cfg(target_os = "android")]
fn jni_call_route_physical() -> Option<bool> {
    let vm = crate::notifications::GLOBAL_JVM.get()?;
    vm.attach_current_thread(|env| -> Result<bool, jni::errors::Error> {
        let main_class = env
            .find_class(jni::jni_str!("me/junioraww/max/MainActivity"))?;
        let res = env
            .call_static_method(
                main_class,
                jni::jni_str!("routeProcessDirectPhysicalNetwork"),
                jni::jni_sig!("()Z"),
                &[],
            )?
            .z()?;
        Ok(res)
    })
    .ok()
}

#[cfg(target_os = "android")]
fn jni_call_detach_route() -> Option<bool> {
    let vm = crate::notifications::GLOBAL_JVM.get()?;
    vm.attach_current_thread(|env| -> Result<bool, jni::errors::Error> {
        let main_class = env
            .find_class(jni::jni_str!("me/junioraww/max/MainActivity"))?;
        let res = env
            .call_static_method(
                main_class,
                jni::jni_str!("detachProcessNetworkRoute"),
                jni::jni_sig!("()Z"),
                &[],
            )?
            .z()?;
        Ok(res)
    })
    .ok()
}
