import {readFileSync,writeFileSync} from 'node:fs';
let source=readFileSync('worker/index.js','utf8');
const assets=['index.html','styles.css','logic.mjs','app.mjs'];
for(const file of assets) source=source.replace(`__${file.replace('.','_').toUpperCase()}__`,JSON.stringify(readFileSync(`dist/${file}`,'utf8')));
writeFileSync('dist/server/index.js',source);
