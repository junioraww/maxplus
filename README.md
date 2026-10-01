<div align="center">

<img src="static/favicon.png" width="120" height="120" alt="Max+ Logo" style="border-radius: 24px; margin-bottom: 20px;">

# Max+ Client

**Неофициальный клиент «Макс» с поддержкой сквозного E2E-шифрования.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/Rust-red?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![Svelte](https://img.shields.io/badge/Svelte-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)](https://svelte.dev/)

</div>

## Предостережения

> [!WARNING]
> Не призываю никого скачивать данный клиент и заводить аккаунт в Max **как альтернативу Telegram**. Делайте это только в крайнем случае, когда активны белые списки или хочется поэкспериментировать.

> [!WARNING]
> **Сервер может опознать сторонний клиент,** используйте на свой риск!

> [!IMPORTANT]
> Поддерживаются версии **Android 9 и выше** (рекомендуется Android 13 и выше)

## ✨ Стать тестером Max+ (.apk, .ipa)

[![Download APK](https://img.shields.io/badge/Скачать_Pre--release-APK-blue?style=for-the-badge&logo=android&logoColor=white)](https://github.com/junioraww/maxplus/releases/latest)

## Содержание

- [Особенности](#особенности)
- [Использование](#использование)
- [Разработка](#разработка)
- [Сборка проекта](#сборка-проекта)
- [Поддержать проект](#-поддержи-проект)
- [Источники](#благодарности)

## Особенности

- **Открытый исходный код**
- Приложение весит всего **от 5 до 20 МБ**
- Написано с нуля, есть **почти все** из официального клиента
- Возможность **шифровать все сообщения и медиафайлы**
- Просмотр и **блокировка запросов** к oneme[.]ru и ok[.]ru

**Небольшой размер приложения достигается использованием системного WebView (Tauri)**

## Использование

Скачать клиент можно из раздела [Releases](https://github.com/junioraww/maxplus/releases) и [на сайте.](https://maxplus.dev/)

- **Чтобы приложение запустилось, архитектура процессора должна совпасть**.  
  Например: ваш смартфон современный и имеет процессор arm64, тогда устанавливаете maxplus-arm64-x.y.z.apk

### Про обновления

Проверять обновления можно в настройках.

**Зеркала проекта:**

[![GitHub](https://img.shields.io/badge/GitHub-main-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/junioraww/maxplus)
[![GitLab](https://img.shields.io/badge/GitLab-mirror-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white)](https://gitlab.com/junioraww/maxplus)
[![Codeberg](https://img.shields.io/badge/Codeberg-mirror-2185D0?style=for-the-badge&logo=codeberg&logoColor=white)](https://codeberg.org/junioraww/maxplus)

## Разработка

Модификация кода приветствуется — сейчас проект очень сырой!

### Требования

- **[Bun](https://bun.sh)** или [NodeJS](https://nodejs.org/)
- **[Rust](https://www.rust-lang.org/)** (для Tauri и сборки)
- **[Android Studio](https://developer.android.com/studio)** и зависимости для сборки под Android
- Немного знания Svelte и Rust

### Установка

```sh
# Папка rumax должна быть наравне с папкой maxplus (можно изменить в Cargo.toml)
git clone https://github.com/junioraww/maxplus
git clone https://github.com/junioraww/rumax
cd maxplus
bun install # Или npm install / pnpm install
bun run tauri icon static/favicon.png # Важно для запуска
```

### Запуск Development сервера

Чтобы запустить сервер для разработки, выполните команду:

```sh
# Разработка в Desktop-режиме (не поддерживает Android-специфичные плагины)
bun run tauri dev
```

```sh
# Разработка через adb (предварительно запустите Android Studio и законнектите устройство)
bun run tauri android dev
```
```sh
# Опционально (если ошибки из-за jdk > 17)
JAVA_HOME=/usr/lib/путь_к_jdk_17 bun run tauri android dev
```

Чтобы ускорить запуск на Android, создайте копию `tauri.conf.json` - `tauri.android.conf.json`
и укажите в `devUrl` точный адрес ПК в локальной сети.

- [Установка Android Studio](https://developer.android.com/studio)
- [Подключение устройства Android](https://developer.android.com/codelabs/basic-android-kotlin-compose-connect-device)
- На Linux процесс может быть немного сложнее.

### Отладка на Android

С запущенным приложением (`bun run tauri android dev`):

Перейти в Chrome на `chrome://inspect#devices` -> WebView in org.meowkie.max (tauri.localhost)

## Сборка проекта

Для сборки под Windows, Linux, iOS нужна предварительная настройка
([Windows](https://v2.tauri.app/distribute/windows-installer/), [Debian](https://v2.tauri.app/distribute/debian/), [iOS](https://v2.tauri.app/distribute/app-store/), [macOS](https://v2.tauri.app/distribute/macos-application-bundle/))

### Сборка под Android в среде Linux

> [!IMPORTANT]
> Вместо локальной сборки, можно воспользоваться готовым скриптом **GitHub Actions**. Это сэкономит ~5-10 ГБ на диске.

1. Установите `Android Studio`, а в нём дополнительно: `Android NDK`, `Android SDK` и по желанию `Android Emulator`

2. Согласно инструкции на сайте Tauri, настройте переменные среды **`NDK_HOME`, `ANDROID_HOME`**

3. Создайте [Java Keystore](https://v2.tauri.app/distribute/sign/android/#creating-a-keystore-and-upload-key) в папке проекта:

```sh
keytool -genkeypair -v \
  -keystore src-tauri/gen/android/app/keystore.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias app-release-key
```

4. Настройте `keystore.properties` в папке проекта:

```
# Если указали пароль при создании keystore, здесь его надо повторить
cd src-tauri/gen/android
mv keystore.properties.example keystore.properties
nano keystore.properties
```

5. **Сама сборка**  
   Вместо aarch64 можно подставить другую архитектуру (armv7, i686, x86_64). Можно собрать для всех платформ Android сразу (увеличится размер .apk)

```sh
# Для конкретной архитектуры
cargo tauri android build --target aarch64
```

```sh
# Единый .apk для всех архитектур
cargo tauri android build
```

### Сборка под iOS 15+ на macOS

В CI используется Xcode 16.4. После установки [зависимостей для iOS](https://v2.tauri.app/start/prerequisites/#ios) и зависимостей проекта:

```sh
bun tauri ios init
bun run tauri icon static/favicon.png
bun tauri ios build --target aarch64 --no-sign
```

Неподписанный IPA появится в `src-tauri/gen/apple/build/arm64/`. Для установки на устройство его нужно подписать. Для сборки с подписью настройте [Apple Developer и подпись Tauri](https://v2.tauri.app/distribute/sign/ios/) и уберите `--no-sign`.

GitHub Actions **Build Max+ iOS** выполняет ту же release-сборку при push в `main`, в pull request и вручную через `workflow_dispatch`. IPA доступен в артефакте `maxplus-ios-unsigned` завершённого запуска. Workflow не публикует GitHub Release.

## Сброс данных клиента

> [!CAUTION]
> Секретные чаты и ключи шифрования удаляются безвозвратно!

**Для Linux:**

```sh
rm -rf ~/.local/share/org.meowkie.max
```

**Для Android:**

Очистка кеша и данных приложения через настройки.

## В планах

- [x] Мини-приложения
- [x] Уведомления
- [ ] Звонки с шифрованием
- [ ] Новый дизайн приложения
- [ ] Шифрование в группах
- [ ] Кастом реакции и фон

## 💖 Поддержи проект!

Понравился Max+ или хочешь поддержать его развитие?  
Твоя поддержка помогает мне уделять больше времени разработке, добавлять новые функции и обслуживать проект.

- 💎 **Донат:** https://web.tribute.tg/d/RcC
- 💰 **BTC:** `1FsDaiMXPtEjtfiAoTPDG5s2GXzMSJY5G9`
- 💳 **ETH:** `0x8F6eD9e232dD06b87a68DdD1AF8b1B5AE5aAa070`
- ☕ **Boosty:** https://boosty.to/catsoft

⭐ **Если проект оказался полезным — поставь звезду!**

<a href="https://www.star-history.com/?repos=junioraww%2Fmaxplus&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=junioraww/maxplus&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=junioraww/maxplus&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=junioraww/maxplus&type=date&legend=top-left" />
 </picture>
</a>

## Благодарности

- [PyMax](https://github.com/noxzion/PyMax) — работа с Max API (портировано на Rust в репозитории [rumax](https://github.com/junioraww/rumax))
- [Tauri](https://github.com/tauri-apps/tauri) — фреймворк для разработки приложений на WebView
- [x25519-dalek](https://crates.io/crates/x25519-dalek), [ed25519-dalek](https://crates.io/crates/ed25519-dalek) и [chacha20poly1305](https://crates.io/crates/chacha20poly1305) — криптография для сквозного шифрования
