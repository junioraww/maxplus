import {
  checkStatus,
  getData,
  setData,
  hasData,
  removeData,
  BiometryType,
} from "@choochmeque/tauri-plugin-biometry-api";

const DOMAIN = "ru.maxplus.keys";

const keyName = (accountId) => `acc_${accountId}`;

export async function checkHardwareBiometry() {
  try {
    const status = await checkStatus();
    return {
      available: !!status?.isAvailable,
      biometryType: status?.biometryType ?? BiometryType.None,
      error: status?.error,
      errorCode: status?.errorCode,
    };
  } catch (e) {
    return {
      available: false,
      biometryType: BiometryType.None,
      error: String(e),
    };
  }
}

export function formatBiometryName(type) {
  switch (type) {
    case BiometryType.FaceID:
      return "Face ID";
    case BiometryType.TouchID:
      return "Отпечаток пальца / Touch ID";
    case BiometryType.Iris:
      return "Сканер радужки";
    case BiometryType.Auto:
      return "Биометрия";
    default:
      return "Биометрия / PIN";
  }
}

export async function storeHardwareKey(accountId, keyHex) {
  await setData({
    domain: DOMAIN,
    name: keyName(accountId),
    data: keyHex,
  });
}

export async function retrieveHardwareKey(accountId, reason) {
  const result = await getData({
    domain: DOMAIN,
    name: keyName(accountId),
    reason: reason || "Подтвердите личность для доступа к данным",
    cancelTitle: "Отмена",
  });
  return result?.data;
}

export async function checkHasHardwareKey(accountId) {
  try {
    return await hasData({
      domain: DOMAIN,
      name: keyName(accountId),
    });
  } catch {
    return false;
  }
}

export async function deleteHardwareKey(accountId) {
  try {
    await removeData({
      domain: DOMAIN,
      name: keyName(accountId),
    });
  } catch {}
}
