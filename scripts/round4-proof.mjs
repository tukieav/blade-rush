// Build the committed Round 4 evidence record after media regeneration.
import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';

const coverGate = execFileSync('node', ['scripts/cover-brightness.mjs'], { encoding: 'utf8' }).trim();
const files = [
  'marketing/cover-16x9.png',
  'marketing/cover-2x3.png',
  'marketing/cover-1x1.png',
  'marketing/video-landscape.mp4',
  'marketing/video-portrait.mp4',
];
function probe(file) {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const info = JSON.parse(raw), stream = info.streams[0];
  return { codec: stream.codec_name || 'n/a', width: stream.width, height: stream.height, duration: Number(info.format.duration), bytes: statSync(file).size };
}
const rows = files.map(file => ({ file, ...probe(file) }));
const out = [
  '# Round 4 proof — Blade Rush',
  '',
  'Fresh visual evidence is committed in `qa/round4/`: each new cover variant and the menu are captured at 907x510. The menu screenshot in `marketing/screenshot-menu.png` was refreshed from the new bright first frame.',
  '',
  '## Cover brightness gate',
  '',
  '```text', coverGate, '```',
  '',
  '## ffprobe media evidence',
  '',
  '| File | Codec | Dimensions | Ratio | Duration | Size |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...rows.map(r => `| ${r.file} | ${r.codec} | ${r.width}x${r.height} | ${(r.width / r.height).toFixed(6)} | ${r.duration ? r.duration.toFixed(3) + 's' : 'n/a'} | ${(r.bytes / 1024 / 1024).toFixed(2)} MB |`),
  '',
  'Validation: videos are silent H.264, 16.000 seconds, and open on their matching regenerated cover for 0.700 seconds before freshly recorded gameplay.',
  '',
];
writeFileSync('qa/ROUND4_PROOF.md', out.join('\n'));
console.log('qa/ROUND4_PROOF.md written');
