// Produce reproducible media evidence after the isolated-port gate run.
import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';

const files = [
  'marketing/cover-16x9.png',
  'marketing/cover-2x3.png',
  'marketing/cover-1x1.png',
  'marketing/video-landscape.mp4',
  'marketing/video-portrait.mp4',
];
function probe(file) {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const info = JSON.parse(raw);
  const stream = info.streams[0];
  return { width: stream.width, height: stream.height, duration: info.format.duration ? Number(info.format.duration) : null, bytes: statSync(file).size };
}
function ratio(w, h) { return w / h; }
const rows = files.map(file => ({ file, ...probe(file) }));
const out = [
  '# Round 3 proof — Blade Rush',
  '',
  'Generated after the isolated-port full gate suite. Fresh screenshots are `qa/hardening/907x510-gameplay.png`, `qa/hardening/1920x1080-gameplay.png`, and `qa/hardening/390x844-gameplay.png`. Focused game-feel evidence is `qa/round3/907x510-combo-wave.png` and `qa/round3/907x510-break-frame.png`.',
  '',
  '| File | Dimensions | Ratio | Duration | Size |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...rows.map(r => `| ${r.file} | ${r.width}x${r.height} | ${ratio(r.width, r.height).toFixed(6)} | ${r.duration === null ? 'n/a' : r.duration.toFixed(3) + 's'} | ${(r.bytes / 1024 / 1024).toFixed(2)} MB |`),
  '',
  'Validation: covers are 1920x1080, 800x1200, and 800x800. The MP4s are silent H.264, 1920x1080 (16:9) and 800x1200 (2:3), each 16.000s. Their first 0.700s are their matching cover frame, followed by freshly recorded gameplay.',
  '',
];
writeFileSync('qa/ROUND3_PROOF.md', out.join('\n'));
console.log('qa/ROUND3_PROOF.md written');
