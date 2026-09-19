<div align="center">

<img src="static/favicon.png" width="120" height="120" alt="Max+ Logo" style="border-radius: 24px; margin-bottom: 20px;">

<h1>Max+ Client</h1>

**Неофициальный клиент «Макс» с поддержкой сквозного E2E-шифрования.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/Rust-red?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-orange?style=for-the-badge&logo=javascript&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

</div>

<b>Что НЕ реализовано:</b>  
➖ Уведомления, звонки, поддержка WebApps, в том числе сферум, стикеры, скачивание чатов, работа с папками, настройки приватности

<b>Что реализовано:</b>  
➕ Вход, регистрация, работа с контактами, каналы и чаты, функции сообщений, сохранение удаленных сообщений, включение шифрования

<b>Что еще будет:</b>  
➕ Светлая тема, Telegram Proxy, разные интерфейсы, шифрованные звонки, поддержка кастомного сервера

## Предостережения

> [!WARNING]
> Не призываю никого скачивать данный клиент и заводить аккаунт в Max <b>как альтернативу Telegram</b>. Делайте это только в крайнем случае, когда активны белые списки или хочется поэкспериментировать.

> [!WARNING]
> <b>Сервер может опознать сторонний клиент,</b> используйте на свой риск!

> [!IMPORTANT]
> Поддерживаются версии <b>Android 9 и выше</b> (рекомендуется Android 13 и выше)

### ✨ Стать тестером Max+ (.apk, .ipa)

[![Download APK](https://img.shields.io/badge/Скачать_Pre--release-APK-blue?style=for-the-badge&logo=android&logoColor=white)](https://github.com/me0wkie/maxplus/releases/latest)

### 💖 Поддержи проект!

Понравился Max+ или хочешь поддержать его развитие?  
Твоя поддержка помогает мне уделять больше времени разработке, добавлять новые функции и поддерживать проект.

⭐ **Если проект оказался полезным — поставь звезду!**

- ☕ **Boosty:** https://boosty.to/catsoft
- 💰 **BTC:** `1FsDaiMXPtEjtfiAoTPDG5s2GXzMSJY5G9`
- 💳 **ETH:** `0x8F6eD9e232dD06b87a68DdD1AF8b1B5AE5aAa070`

## Содержание

- [Особенности](#особенности)
- [Использование](#использование)
- [Разработка](#разработка)
- [Сборка проекта](#сборка-проекта)
- [В планах](#в-планах)
- [Источники](#источники)

### Особенности

- <b>Открытый исходный код</b>
- Приложение не требует доступ к файлам устройства, микрофону, камере
- Прозрачность запросов к oneme[.]ru и ok[.]ru, можно просматривать каждый запрос в логах
- Сквозное E2E шифрование (можно включить для отдельных чатов)
- В планах: поддержка звонков, многопользовательских чатов

<b>Небольшой размер приложения достигается использованием системного WebView (Tauri)</b>

> [!NOTE]
> Для покупки пива в Магните можно разрешить доступ к камере (QR-сканер)

## Использование

Предварительные версии доступны в разделе [Releases](https://github.com/me0wkie/maxplus/releases)

- <b>Чтобы приложение запустилось, архитектура процессора должна совпасть</b>.  
  Например: устройство имеет процессор arm64, тогда устанавливаете maxplus-android-aarch64.apk

- <b>Если не удается запустить, попробуйте заменить браузер по умолчанию на устройстве</b>.

### Про обновления

Проверять обновления можно в настройках. <b>Если GitHub ограничен:</b>
- <b>[Зеркало Codeberg](https://codeberg.org/meowkie/maxplus)</b>

## Разработка

Модификация кода приветствуется — сейчас проект очень сырой!

### Требования

- <b>[Bun](https://bun.sh)</b> или [NodeJS](https://nodejs.org/)
- <b>[Rust](https://www.rust-lang.org/)</b> (для Tauri и сборки)
- <b>[Android Studio](https://developer.android.com/studio)</b> и зависимости для сборки под Android
- Немного знания Svelte и Rust, либо наличие ChatGPT Pro

### Установка

```sh
$ git clone https://github.com/me0wkie/maxplus
git clone https://github.com/me0wkie/rumax
cd maxplus
bun install # Или npm install / pnpm install
bun run tauri icon static/favicon.png # Важно для запуска
```

В стандартном окружении, папка [rumax](https://github.com/me0wkie/rumax) должна быть наравне с папкой `maxplus` (можно изменить в `Cargo.toml`)

### Запуск Development сервера

Чтобы запустить сервер для разработки, выполните команду:

```sh
# Разработка в Desktop-режиме (не поддерживает Android-специфичные плагины)
$ bun run tauri dev

ИЛИ

# Разработка через adb (предварительно запустите Android Studio и законнектите устройство)
$ bun run tauri android dev

# Опционально (если ошибки из-за jdk > 17)
$ JAVA_HOME=/usr/lib/путь_к_jdk_17 bun run tauri android dev
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
> Вместо локальной сборки, можно воспользоваться готовым скриптом <b>GitHub Actions</b>. Это сэкономит ~5-10 ГБ на диске.

1. Установите `Android Studio`, а в нём дополнительно: `Android NDK`, `Android SDK` и по желанию `Android Emulator`

2. Согласно инструкции на сайте Tauri, настройте переменные среды <b>`NDK_HOME`, `ANDROID_HOME`</b>

3. Создайте [Java Keystore](https://v2.tauri.app/distribute/sign/android/#creating-a-keystore-and-upload-key) в папке проекта:

```sh
$ keytool -genkeypair -v \
  -keystore src-tauri/gen/android/app/keystore.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias SECRET_123
```

4. Настройте `keystore.properties` в папке проекта:

```
$ cd src-tauri/gen/android
mv keystore.properties.example keystore.properties
nano keystore.properties
```

5. <b>Сама сборка</b>  
   Вместо aarch64 можно подставить другую архитектуру (armv7, i686, x86_64). Можно собрать для всех платформ Android сразу (увеличится размер .apk)

```sh
# Для конкретной архитектуры
$ cargo tauri android build --target aarch64

ИЛИ

# Единый .apk для всех архитектур
$ cargo tauri android build
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
Секретные чаты теряются!

<b>Для Linux:</b>

```sh
$ rm -rf ~/.local/share/org.meowkie.max
```

<b>Для Android:</b>

Очистка кеша и данных приложения через настройки

## В планах

- [ ] Мини-приложения и Сферум
- [ ] Уведомления
- [ ] Шифрование в группах по схеме MLS
- [ ] Установка любых реакций и фона
- [ ] Звонки с e2e шифрованием

## Источники

- [PyMax](https://github.com/noxzion/PyMax) — работа с Max API (портировано на Rust в репозитории [rumax](https://github.com/me0wkie/rumax))
- [Tauri](https://github.com/tauri-apps/tauri) — фреймворк для разработки приложений на WebView
- [libsodium-wrappers-sumo](https://www.npmjs.com/package/libsodium-wrappers-sumo) — криптография для сквозного шифрования
