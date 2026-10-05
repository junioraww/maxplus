export function parseApiError(err) {
  if (!err) return "Неизвестная ошибка";
  if (typeof err === "string") {
    try {
      const parsed = JSON.parse(err);
      return parseApiError(parsed);
    } catch {
      return err;
    }
  }
  if (err.localizedMessage) return err.localizedMessage;
  if (err.title) return err.title;
  if (err.error) {
    if (typeof err.error === "string") {
      if (err.error === "WRONG_PASSWORD") return "Неверный пароль";
      if (err.error === "error.user.blocked.send") return "Начать диалог не получится. Возможности профиля ограничены";
      return err.localizedMessage || err.title || err.message || err.error;
    }
    return JSON.stringify(err.error);
  }
  if (err.message && typeof err.message === "string") return err.message;
  if (err.text) {
    try {
      const parsed = JSON.parse(err.text);
      return parseApiError(parsed);
    } catch {
      return err.text;
    }
  }
  return "Ошибка запроса";
}
