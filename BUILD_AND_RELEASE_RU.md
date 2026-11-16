# Software Hub v0.7.5 — сборка и GitHub Release (Windows 11)

**Репозиторий:** https://github.com/TraurigerEngel/SoftwareHub (публичный). Последний проверенный опубликованный релиз до сборки: v0.7.4. Новая версия v0.7.5, 141 карточка: 92 программы и 49 сайтов.

## 1. Необходимые инструменты

- **Node.js 22.x** с npm.
- **Rust** / cargo, активный toolchain `stable-x86_64-pc-windows-msvc` (установка через rustup).
- **Visual Studio Build Tools** с workload «Разработка классических приложений на C++» и Windows SDK.
- Для публикации: **Git for Windows** и **GitHub CLI** (`gh`); авторизация `gh auth login` в учётной записи с доступом на запись в `TraurigerEngel/SoftwareHub`.
- **Microsoft Edge WebView2 Runtime** для запуска Windows приложения.

Проверить версии в PowerShell: `node -v`, `npm -v`, `rustc -vV`, `cargo -V`, `git --version`, `gh --version`.

## 2. Сборка

Извлеките архив исходников в **новую папку** (не поверх действующей portable-копии), затем в этой папке откройте PowerShell и выполните:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\BUILD-ON-WINDOWS.ps1
```

Сценарий последовательно запускает `npm ci`, проверку 165+ тестов, `cargo test --locked --lib`, сборку Tauri x64, проверку манифеста и подготовку Source/Portable ZIP с SHA-256. Если что-то не установлено или тест не пройден, публикация не производится.

Результат: `Artifacts\Software_Hub_v0.7.5_Stable\` с тремя файлами:

- `Software_Hub_v0.7.5_Stable_Portable.zip`
- `Software_Hub_v0.7.5_Stable_Source.zip`
- `SHA256SUMS.txt`

Журнал — `BuildLogs\build-YYYYMMDD-HHMMSS.txt` (не входит в GitHub-архивы).

Повторный запуск сборки в той же папке с уже созданным `Release` или `Artifacts` **может остановиться**, чтобы не перезаписывать артефакты. Для чистого повторного прогона используйте новую распакованную папку и сохраните журнал ошибочного запуска.

## 3. Проверка EXE

Распакуйте копию **Portable.zip** в отдельную папку. Запустите `SoftwareHub.exe`, проверьте интерфейс, наличие 141 карточки и переходы по новым сайтам. Убедитесь, что проверка версий происходит только по кнопке «Обновить версии», и что после закрытия/повторного запуска приложение работает корректно. Не заменяйте рабочую v0.7.4 до подтверждения новой сборки. Если нужно перенести свои данные, отдельно сохраните резервную копию `portable-data`.

## 4. GitHub Release

Если `git` и `gh` ещё не настроены, выполните один раз `gh auth login` и при необходимости `git config --global user.name "..."`, `git config --global user.email "..."`.

**Только после успешной проверки EXE** запустите:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\PUBLISH-GITHUB-RELEASE.ps1 -ConfirmedSmokeTest
```

Скрипт проверяет SHA-256, приватные файлы, имя публичного репозитория и исходный `main`, клонирует чистую ветку, публикует изменения без `--force`, создаёт новый тег v0.7.5 и GitHub Release с тремя Assets. **v0.7.4 не изменяется.** Если с момента подготовки репозиторий изменился, скрипт остановится; это защитная мера.

Если после публикации кода или тега загрузка Assets прервётся, сообщите журнал ошибки для безопасного восстановления; не удаляйте релиз и не переписывайте тег вручную.
