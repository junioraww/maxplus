export function parseApiError(err) {
  if (!err) return "Неизвестная ошибка";
  if (typeof err === "string") {
    try {
      const parsed = JSON.parse(err);
      return parsed.localizedMessage || parsed.message || parsed.error || err;
    } catch {
      return err;
    }
  }
  if (err.localizedMessage) return err.localizedMessage;
  if (err.message) return err.message;
  if (err.error) {
    if (typeof err.error === "string") {
      if (err.error === "WRONG_PASSWORD") return "Неверный пароль";
      return err.error;
    }
    return JSON.stringify(err.error);
  }
  if (err.text) {
    try {
      const parsed = JSON.parse(err.text);
      if (parsed.localizedMessage) return parsed.localizedMessage;
      if (parsed.message) return parsed.message;
      if (parsed.error) {
        if (parsed.error === "WRONG_PASSWORD") return "Неверный пароль";
        return parsed.error;
      }
    } catch {
      return err.text;
    }
  }
  return "Ошибка аутентификации";
}
