# dsh-plugin-read-aloud

Read DSH replies aloud in a natural Microsoft neural voice — 晓晓 / 云希 and friends, the same voice family as Edge's Read Aloud — instead of the robotic system SAPI voice.

Select text in a finished reply to reveal a floating action bar, or right-click anywhere in a reply to read the whole thing. Voice and speed switch from the same bar. Audio comes from a local `edge-tts` service, streamed through the DSH HTTP server on the same origin, so playback starts before the whole paragraph is synthesized and segments run back to back.

中文见下。

## What you get

- **🔊 Read selection** — the selected paragraph, nothing else.
- **📄 Read entire reply** — the whole reply containing the selection or the right-click.
- **🗣 Voice** — cycles 晓晓 / 晓伊 / 云希 / 云健 / 云扬 / 晓北. Shows the chosen name when neural speech is live, and **Built-in voice** when it fell back to the browser engine.
- **1× Speed** — 0.75× / 1× / 1.25× / 1.5×, remembered in the browser.
- **⏹ Stop** — the first button toggles while speaking.

Long text is split into ≤600-character pieces: the first piece is cut to a short sentence for a fast start, and the next piece is preloaded while the current one plays.

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
- Unreadable content is dropped, never replayed: box-drawing rules, arrows, emoji, symbols and control characters are stripped before synthesis, lines left empty are skipped, and a piece that fails twice is skipped while reading continues. Nothing already heard is ever read again, and the engine never switches mid-message; only a message that has not started yet falls back to the browser voice.
- "Entire reply" means the host's text-interaction container (`data-text-interaction-source`); when that container holds only one paragraph, only that paragraph is read.
- File previews in the sidebar cannot be read yet.
- Non-Chinese text is read too, but the listed voices are Chinese; pick a different voice only by editing `server/tts_server.py`'s `VOICES` list for now.
- First sound takes roughly 0.6–1.2 s (online synthesis latency).

## License

MIT.

---

# 中文说明

把 DSH 的回复念出来，用的是微软神经网络语音（晓晓、云希等，和 Edge「大声朗读」同一音源），不再是系统自带的机械音。

**用法**：选中已完成的回复文字 → 选区上方出现操作条；或在回复里右键 → 读整条。操作条上依次是「朗读选中 / 朗读整条 / 音色 / 语速」，朗读时第一个按钮变成「停止」。音色按钮显示「晓晓」等名字表示神经网络语音生效，显示「内置语音」表示已退回浏览器语音。

**安装**：插件 → 添加插件 → 输入 `dsh-plugin-read-aloud`，装完重启一次 DSH，再 Ctrl+Shift+R 刷新页面。

**依赖**：Python 3.9+ 且装好 `edge-tts`（`python -m pip install edge-tts`）；合成需要联网。缺依赖或断网时自动退回浏览器语音，不会没反应。

**链路**：页面请求同源的 `/read-aloud/tts` → 宿主插件转发 → 只绑定回环地址的 `127.0.0.1:17865`（Python + edge-tts）→ 流式 mp3。同源转发避免了跨域限制，流式返回让声音边合成边播。

**许可**：MIT。
