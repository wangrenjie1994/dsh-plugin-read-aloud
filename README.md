# dsh-plugin-read-aloud

Read DSH replies aloud in a natural Microsoft neural voice — 晓晓 / 云希 and friends, the same voice family as Edge's Read Aloud — instead of the robotic system SAPI voice.

Select text in a finished reply to reveal the action panel, or press **Shift + right-click** anywhere in a reply to open it without selecting anything. Voice and speed switch from the same panel. Audio comes from a local `edge-tts` service, streamed through the DSH HTTP server on the same origin, so playback starts before the whole paragraph is synthesized and segments run back to back.

中文见下。

## What you get

Selecting text in a reply, or **Shift + right-click** anywhere in it, opens a two-row panel:

| | | |
|---|---|---|
| 🔊 Read selection | ▶ Read from here | 📄 Read entire reply |
| 🗣 Voice | 1× Speed | ⧉ Copy |

- **Read from here** starts at the selection and continues to the end of the reply, so earlier text is never repeated.
- **Voice** cycles 晓晓 / 晓伊 / 云希 / 云健 / 云扬 / 晓北 and shows **Built-in voice** when the browser engine is in use.
- **Copy** duplicates the selection (or the whole reply without one) in a single click.
- **Plain right-click is untouched**: the browser menu with copy, translate and inspect still opens. Only Shift + right-click is taken over, so the panel and that menu never cover each other.
- The first button toggles to **Stop** while speaking.

Long text is split into ≤600-character pieces: the first piece is cut to a short sentence for a fast start, and the next piece is preloaded while the current one plays.

## What it will not read

Only characters a speech engine can actually voice reach it: letters (any script), digits, ordinary punctuation, and line breaks. Everything else is replaced by a space before synthesis, so the following are silently skipped rather than pronounced:

- diagrams, tables and rules — box-drawing and block characters such as `─ │ ┌ ▓`
- arrows and bullets such as `← → ⇒ •`
- emoji, symbols and math signs such as `✅ ∑ ≈ ★`
- zero-width characters, control characters and broken code points

A line left with nothing readable after that is dropped entirely, so the reader never stops on a separator line.

## What happens when a piece fails

1. The failing piece is retried once.
2. If it still fails, that piece is **skipped** and reading continues with the next one — nothing already heard is played again, and the voice never changes mid-message.
3. Only a reply that has not started speaking yet may fall back to the browser's own speech engine; in that case the voice cell shows **Built-in voice**.

## Requirements

- DSH `>= 0.2.2-rc.3` (Web GUI in a browser).
- Python 3.9+ with `edge-tts` installed: `python -m pip install edge-tts`. The plugin finds the DSH-bundled Python runtime automatically, then falls back to `python` / `python3` / `py` on `PATH`.
- Network access for synthesis. Without it, or without Python, the plugin quietly falls back to the browser's own speech synthesis and says so on the voice button.

## Install

From the DSH GUI: **Plugins → Add plugin**, then enter `dsh-plugin-read-aloud`. Or from a local directory containing this package, point **Add plugin** at its folder.

Restart DSH once after installing, then hard-refresh the page (Ctrl+Shift+R).

## How it works

```
page → /read-aloud/tts        (same origin, DSH HTTP server)
     → host plugin proxy     (streams the bytes)
     → 127.0.0.1:17865       (Python + edge-tts, loopback only)
     → mp3 chunks
```

- The speech service binds loopback only; nothing is exposed to the network.
- Same-origin delivery avoids CORS and cross-origin media restrictions.
- `GET /read-aloud/health` lists the voices and drives the fallback decision.

## Limitations

- Reads settled Assistant text, user messages, and reasoning. Streaming text, tool cards, and injected context are not selectable this way.
- "Entire reply" means the host's text-interaction container (`data-text-interaction-source`); when that container holds only one paragraph, only that paragraph is read.
- File previews in the sidebar cannot be read yet.
- Non-Chinese text is read too, but the listed voices are Chinese; pick a different voice only by editing `server/tts_server.py`'s `VOICES` list for now.
- First sound takes roughly 0.6–1.2 s (online synthesis latency).

## License

MIT.

---

# 中文说明

把 DSH 的回复念出来，用的是微软神经网络语音（晓晓、云希等，和 Edge「大声朗读」同一音源），不再是系统自带的机械音。

## 用法

- **选中回复里的文字** → 选区上方出现操作面板。
- **在回复上按 Shift + 右键** → 不选中任何文字也能呼出同一个面板。

普通右键不受影响，浏览器自带的复制、翻译、检查等菜单照常弹出；只有 Shift + 右键会被插件接管，所以面板和原生菜单永远不会互相遮挡。

| | | |
|---|---|---|
| 🔊 朗读选中 | ▶ 从当前读 | 📄 朗读整条 |
| 🗣 晓晓 | 1× 语速 | ⧉ 复制 |

- **朗读选中**：只念选中的那一段。
- **从当前读**：从选区开头念到这条回复结尾，前面的内容不再重复。
- **朗读整条**：整条回复全念。
- **音色**：晓晓 / 晓伊 / 云希 / 云健 / 云扬 / 晓北，选择记在浏览器本地；显示「内置语音」表示已退回浏览器语音。
- **语速**：0.75 / 1 / 1.25 / 1.5 倍。
- **停止**：朗读时左上角变成「⏹ 停止朗读」。

## 哪些字符不读

只有语音引擎念得出来的字符才会送进去：文字（任何语言）、数字、常规标点、换行。其余字符在合成前统一替换成空格，所以下面这些**不会出声**，直接跳过：

- 图表里的线条和方块：`─ │ ┌ ▓` 等制表符、块元素
- 箭头和项目符号：`← → ⇒ •`
- emoji、数学与其他符号：`✅ ∑ ≈ ★`
- 零宽字符、控制字符、异常码位

清洗后整行没有可读内容的（比如一条分隔线），整行都不读。

## 读不了的部分怎么处理

1. 失败的那一段**重试一次**。
2. 仍然失败就**跳过这一段继续往下读**——不会重读已经听过的内容，也不会中途换音色。
3. 只有整条回复**还没开始出声**时，才会整体退回浏览器语音，此时音色按钮显示「内置语音」。

## 安装

插件 → 添加插件 → 输入 `dsh-plugin-read-aloud`，装完重启一次 DSH，再 Ctrl+Shift+R 刷新页面。

**依赖**：Python 3.9+ 且装好 `edge-tts`（`python -m pip install edge-tts`）；合成需要联网。缺依赖或断网时自动退回浏览器语音，不会没反应。

**链路**：页面请求同源的 `/read-aloud/tts` → 宿主插件转发 → 只绑定回环地址的 `127.0.0.1:17865`（Python + edge-tts）→ 流式 mp3。同源转发避免了跨域限制，流式返回让声音边合成边播。

**许可**：MIT。
