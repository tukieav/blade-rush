# Round 4 proof — Blade Rush

Fresh visual evidence is committed in `qa/round4/`: each new cover variant and the menu are captured at 907x510. The menu screenshot in `marketing/screenshot-menu.png` was refreshed from the new bright first frame.

## Cover brightness gate

```text
PASS marketing/cover-16x9.png meanLum=128.65 darkFrac=0.0029 meanSat=0.5903
PASS marketing/cover-2x3.png meanLum=131.88 darkFrac=0.0038 meanSat=0.5924
PASS marketing/cover-1x1.png meanLum=132.18 darkFrac=0.0042 meanSat=0.6000
ALL COVER BRIGHTNESS GATES PASSED
```

## ffprobe media evidence

| File | Codec | Dimensions | Ratio | Duration | Size |
| --- | --- | ---: | ---: | ---: | ---: |
| marketing/cover-16x9.png | png | 1920x1080 | 1.777778 | n/a | 1.09 MB |
| marketing/cover-2x3.png | png | 800x1200 | 0.666667 | n/a | 0.52 MB |
| marketing/cover-1x1.png | png | 800x800 | 1.000000 | n/a | 0.39 MB |
| marketing/video-landscape.mp4 | h264 | 1920x1080 | 1.777778 | 16.000s | 4.40 MB |
| marketing/video-portrait.mp4 | h264 | 800x1200 | 0.666667 | 16.000s | 3.46 MB |

Validation: videos are silent H.264, 16.000 seconds, and open on their matching regenerated cover for 0.700 seconds before freshly recorded gameplay.
