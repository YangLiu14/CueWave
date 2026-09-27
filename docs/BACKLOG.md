# Backlog

- [ ] YouTube 热力图首版完成后，增加可独立打开的投屏大屏；复用同一视频会话、探针读数和证据交互。
- [ ] 在 YouTube 热力图闭环完成后，用现有 Gemini API 配置做现场 speech-to-text smoke test：验证中文与英文自动识别、临时／最终字幕、连续十分钟后的续接与音频补入；使用付费层，不以临时读数代替正式读数。
- [ ] 调研并实测实时 speech-to-text API：以中文为主、少量英文的 Hackathon pitch 语料比较正式字幕准确性、讲话结束到正式字幕的延迟、连续采集稳定性与整场费用；基于实测选择供应商。已有 Gemini Live Transcribe 作为首个 smoke test 候选；阿里云 Paraformer 等独立 ASR 可作为比较对象。家中 Ubuntu 22.04／RTX 3090 工作站只能经外网访问，不作为现场唯一 ASR 链路。
- [ ] 现场阶段补齐项目段边界拖动、手动合并／拆分与跨边界读数重算；现版仅支持手动新项目及长停顿＋开场语的自动推测。
