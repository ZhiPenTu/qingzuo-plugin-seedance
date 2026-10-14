import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pack } from '@commerce/plugin-sdk/cli';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const stage = path.resolve('release/plugin');
const platform = process.platform + '-' + process.arch;

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp('ui', path.join(stage, 'ui'), { recursive: true });
await cp('LICENSE', path.join(stage, 'LICENSE'));
await writeFile(
  path.join(stage, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, commerce: pkg.commerce }, null, 2)
);

const name = `${pkg.commerce.id}-${pkg.version}-${platform}.ecplugin`;
const filename = path.resolve('release', name);
await pack(stage, filename);
const bytes = await readFile(filename);

await writeFile(
  'release/catalog-' + platform + '.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      plugins: [
        {
          ...pkg.commerce,
          version: pkg.version,
          artifacts: {
            [platform]: {
              url: `https://github.com/ZhiPenTu/qingzuo-plugin-seedance/releases/download/v${pkg.version}/${name}`,
              size: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex')
            }
          }
        }
      ]
    },
    null,
    2
  )
);

console.log('Plugin packed successfully:', filename);
