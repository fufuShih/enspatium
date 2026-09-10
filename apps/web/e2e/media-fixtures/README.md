These are synthetic test fixtures generated locally with FFmpeg, not user media. No FFmpeg installation is needed to run tests or the application.

- `tone.mp3`: 8 seconds of a 440 Hz sine, MP3 at 64 kb/s.
- `clip.mp4`: 8 seconds of testsrc2 at 320x180/15 fps, H.264 yuv420p and AAC sine audio, faststart.
- `clip.webm`: the same testsrc2 pattern, VP9 at 100 kb/s.
- `photo.png`: one 320x180 testsrc2 frame.

The browser tests check playback time advancing and seeking, not just the presence of media tags.
