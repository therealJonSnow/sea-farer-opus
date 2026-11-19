import * as esbuild from 'esbuild';
import fs from 'fs';
const root = new URL('..', import.meta.url).pathname;
const wgslMin = {
  name: 'wgsl-min', setup(b) {
    b.onLoad({ filter: /shaders\.js$/ }, a => {
      let s = fs.readFileSync(a.path, 'utf8');
      s = s.replace(/\/\* wgsl \*\/`([\s\S]*?)`/g, (m, code) => '`' + code
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .replace(/ ?([{}()\[\];,=<>+\-*\/:&|!?.]) ?/g, '$1')
        .replace(/(\b(?:fn|let|var|const|struct|return|if|else|for|continue|select)\b)/g, '$1') + '`');
      return { contents: s, loader: 'js' };
    });
  }
};
const r = await esbuild.build({ entryPoints: [root + 'src/main.js'], bundle: true, format: 'esm', minify: !process.env.DEV, write: false, target: 'chrome120', plugins: [wgslMin] });
const js = r.outputFiles[0].text.trim();
const html = fs.readFileSync(root + 'src/index.template.html', 'utf8').replace('/*JS*/', () => js);
fs.writeFileSync(root + 'index.html', html);
console.log('index.html', html.length, 'bytes');
