# TeleGlance demo — narration mix notes (25 Nov 2026)

Voiceover: TTS voice `avocado_v2:MAI_03` (same as the Aevum demo), one mp3
per script line in `demo/narration/s1.mp3` … `s12.mp3`, mixed with ffmpeg
(`adelay` per line at its scripted start, `amix normalize=0`, AAC 128k).
Video stream copied untouched from `teleglance-demo.mp4`.

Output: `teleglance-demo-narrated.mp4` — 65.733 s, 1280x720, H.264 + AAC.
Original silent `teleglance-demo.mp4` untouched. Verified with ffprobe and
silencedetect: all 12 lines speak inside their scripted windows.

## Per-line adjustments (text is the script's, except where noted)

| Line | Window | Speed | Note |
|------|--------|-------|------|
| s1 | 0:00–0:04 | 140 | 5.28 s at 100 → 4.08 s; speech ends 3.81 s. "G2" read as "G-two" per script note. |
| s2 | 0:04–0:10 | 100 | Fits (speech ends 9.52 s). |
| s3 | 0:10–0:22 | 100 | Fits (speech ends ~15.7 s; rest of the shot is silent by design). |
| s4 | 0:22–0:26 | 100 | Fits. |
| s5 | 0:26–0:31 | 100 | Fits. |
| s6 | 0:31–0:37 | 100 | Fits. Quotes around 'Reply sent.' dropped for TTS (same words). |
| s7 | 0:37–0:41 | 115 | 4.61 s at 100 → 4.06 s; speech ends 40.70 s. |
| s8 | 0:41–0:45 | 100 | Fits (speech ends 44.67 s). |
| s9 | 0:45–0:51 | 100 | Fits (speech ends 50.73 s). |
| s10 | 0:51–0:58 | 100 | Fits. |
| s11 | 0:58–1:02 | 100 | Fits (speech ends 61.95 s, 0.05 s before the next line). |
| s12 | 1:02–1:06 | 100 | TEXT CHANGED: script's raw URL made the TTS spell it letter by letter (24.8 s — cannot fit a 4 s shot, or the 65.7 s video at all). Reworded to "TeleGlance — open source on GitHub." (2.69 s). The full URL stays visible on the outro card. |
