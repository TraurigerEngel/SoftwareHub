# Software Hub 🚀

**v0.7.4 Stable — Security & Manual Refresh** · Windows 11 x64 · Tauri 2 / Rust · Portable.

**Software Hub** — каталог программ и полезных сайтов с поиском, фильтрами, ссылками на официальные источники и ручной проверкой новых версий. Тёмный интерфейс Cinema Mono, фиолетово-розовые акценты и анимированные частицы.

[**Скачать v0.7.4**](https://github.com/TraurigerEngel/SoftwareHub/releases/tag/v0.7.4) · [Описание изменений](RELEASE_NOTES_RU.md) · [Конфиденциальность](GITHUB_PRIVACY_RU.md)

## Возможности

- 126 карточек: 86 программ и 40 сайтов.
- Поиск, категории, страницы и официальные ссылки.
- Проверка версий **только после нажатия «Обновить версии»**. При запуске отображается сохранённый кеш; автоматических проверок нет.
- Доступные версии и журнал диагностики без сохранения полученных HTML-страниц и личных токенов.
- Проверка HTTPS в Rust с обновлёнными `rustls-webpki 0.103.16` и `webpki-roots 1.0.10`.
- Портативная папка `portable-data`; персональные данные остаются локально.

## Установка

1. Скачайте `Software_Hub_v0.7.4_Stable_Portable.zip` в разделе Assets GitHub Release.
2. Распакуйте ZIP в отдельную папку.
3. Запустите `SoftwareHub.exe` рядом с пустой папкой `portable-data`. Нужен **Microsoft WebView2 Runtime**.

Если обновляетесь с прежней версии, сначала сохраните резервную копию своей `portable-data`, затем перенесите её в новую папку вручную. **Не удаляйте предыдущую работающую portable-копию до проверки новой.**

## Проверки и сборка

Windows 11 x64: Node.js 22.x, npm, Rust toolchain MSVC и инструменты Tauri 2.

```powershell
npm ci
npm run verify
cargo test --manifest-path .\src-tauri\Cargo.toml --locked --lib
.\MAKE-RELEASE.cmd
```

Публичные исходники не включают локальные настройки, кэши, пользовательские базы данных, ключи, кеш Cargo, `node_modules`, бинарные шрифты и собранный EXE. Пакет Portable включает пустую `portable-data` и проверяемый `RELEASE-MANIFEST.json`. Коды сторонних зависимостей подчиняются собственным лицензиям.

## Документы

- [RELEASE_NOTES_RU.md](RELEASE_NOTES_RU.md) — изменения v0.7.4.
- [RELEASE_CHECKLIST_RU.md](RELEASE_CHECKLIST_RU.md) — контрольный список публикации.
- [GITHUB_PRIVACY_RU.md](GITHUB_PRIVACY_RU.md) — правила для приватных данных.
- [LICENSE](LICENSE) — MIT License для оригинального кода.

**Репозиторий:** https://github.com/TraurigerEngel/SoftwareHub

**История визуальной ветки:** Visual Preview 11 добавил новую иконку, а последующие версии закрепили текущее оформление. Исторические файлы оставлены для проверки регрессий.
