# Дополнение каталога SoftwareHub — 11.11.2026

Основа: опубликованная SoftwareHub v0.7.4 Stable. Содержимое каталога подготовлено к выпуску **v0.7.5**; интерфейс, механизмы проверки версий и оформление сохранены.

## Добавлены карточки сайтов

| Карточка | Категория | Адрес |
|---|---|---|
| Claude | ИИ | https://claude.ai/new |
| Check-Host — TCP 89.105.219.179:22 | Сеть | https://check-host.net/check-tcp?host=89.105.219.179:22 |
| Cloudflare Speed Test | Сеть | https://speed.cloudflare.com/ru-ru |
| Windows Unattend Generator — GitHub | Windows | https://github.com/rbardtke/windows-unattend-generator |
| ArtCraft | Дизайн | https://getartcraft.com/ |

## Существующие карточки

- **ByeByeDPI** уже присутствовал с точной ссылкой `https://github.com/romanvht/ByeByeDPI/releases`; оставлен без дублирования и без изменения автоматического мониторинга GitHub Releases.
- **Webcam & Mic Test** уже присутствовал с русскоязычной ссылкой `https://webcammictest.com/ru/`. Добавлена вторая кнопка «Главная» с запрошенным адресом `https://webcammictest.com/`.
- **Windows Unattend Generator** (schneegans.de) сохранён как отдельная карточка; вариант `rbardtke/windows-unattend-generator` добавлен отдельно.
- Прежний **Check-Host — TCP 95.182.80.39** сохранён. Новый SSH endpoint создан отдельно, чтобы не потерять старую ссылку.

## Поведение и безопасность

- Веб-сервисы **не участвуют** в автоматической проверке версий. Для них используется существующий `manual-service`.
- IP-адрес и порт из новой карточки сохраняются в статическом каталоге и становятся видимыми каждому получателю архива.
- Кнопки открывают сайты обычным механизмом `open_external`, без фоновых проверок доступности сервера и без исполнения программ.
- Новый релиз будет иметь версию **0.7.5**. Исходный EXE v0.7.4 не меняется. Для применения нового каталога требуется новая сборка.

## Дополнение №2 — 11.11.2026

Добавлено **10 карточек**: 6 программ и 4 сайта. Исходный каталог вырос с **131 до 141 карточки**: 92 программы и 49 сайтов.

| Карточка | Раздел | Адрес | Проверка версий |
|---|---|---|---|
| Win11Debloat | Система | https://github.com/Raphire/Win11Debloat/releases | GitHub Releases (стабильные теги YYYY.MM.DD) |
| Dr.Web CureIt! | Безопасность | https://free.drweb.ru/download+cureit+free/ | Ручная |
| Microsoft Safety Scanner | Безопасность | https://learn.microsoft.com/en-us/defender-endpoint/safety-scanner-download | Ручная |
| Ratool | Безопасность | https://www.majorgeeks.com/files/details/ratool_%28removable_access_tool%29.html | Ручная, стороннее зеркало |
| ComfyUI Desktop | Изображения | https://comfy.org/download | Ручная |
| Omarchy | Linux (сайты) | https://omarchy.org/ | Нет |
| Civitai RED | ИИ (сайты) | https://civitai.red/ | Нет |
| Civitai | ИИ (сайты) | https://civitai.com/ | Нет |
| MTProto Proxy — Telegram | Сеть (сайты) | https://tgmtproxy.github.io/mtproxy/ | Нет |
| LocalSend | Файлы | https://localsend.org/ | GitHub Releases (стабильные теги vX.Y.Z) |

**Существующие ссылки:** Node.js (`https://nodejs.org/en/download`) и RuTracker (`https://rutracker.org/forum/index.php`) уже присутствовали. Оставлены без дублирования; у RuTracker дополнительно появилась кнопка «Главная», открывающая точно указанный адрес `https://rutracker.org`.

**Предосторожности:** Win11Debloat может изменять параметры системы; перед запуском необходима проверка выбранных настроек. Для Dr.Web CureIt! актуальность баз обеспечивается повторной загрузкой. Microsoft Safety Scanner истекает через 10 дней после скачивания. У Ratool первичная ссылка ведёт на сторонний каталог MajorGeeks. Civitai RED включает контент для взрослых (18+). MTProto-прокси обслуживаются сторонними операторами, их конфиденциальность не гарантируется.

Веб-сервисы не участвуют в автообновлении; проверка GitHub Releases у Win11Debloat/LocalSend выполняется только при штатном ручном обновлении версий. Для версии **0.7.5** требуется отдельная сборка Windows. Ранее опубликованная v0.7.4 и её GitHub-артефакты не затрагиваются.
