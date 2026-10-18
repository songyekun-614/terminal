const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const desktop = path.join(root, 'desktop');
const esbuild = require(path.join(desktop, 'node_modules/esbuild'));
const baseline = execFileSync('git', ['show', 'v0.2.2:desktop/renderer/style.css'], { cwd: root, encoding: 'utf8' });
const current = fs.readFileSync(path.join(desktop, 'renderer/style.css'), 'utf8');
// Replace only the old single-pane positioning, retaining all other v0.2.2 rules.
fs.writeFileSync(path.join(__dirname, 'baseline.css'), baseline.slice(0, baseline.indexOf('.terminal-pane {')) + current.slice(current.indexOf('.terminal-tab {'), current.indexOf('.xterm,')) + baseline.slice(baseline.indexOf('.xterm,')));
fs.copyFileSync(path.join(desktop, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(__dirname, 'xterm.css'));
let html = fs.readFileSync(path.join(desktop, 'renderer/index.html'), 'utf8')
  .replace('href="style.css"', 'href="baseline.css"')
  .replace('</head>', '<link id="redesign" rel="stylesheet" href="redesign.css" /></head>')
  .replace('<script src="app.bundle.js"></script>', '<script src="bridge.js"></script><script src="app.bundle.js"></script>');
fs.writeFileSync(path.join(__dirname, 'terminal.html'), html);
// Only the preview uses variable divider widths; leave the product module untouched.
esbuild.build({ entryPoints: [path.join(desktop, 'renderer/app.js')], outfile: path.join(__dirname, 'app.bundle.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', plugins: [{
  name: 'preview-divider-width',
  setup(build) {
    build.onLoad({ filter: /[/\\]splits\.js$/ }, args => ({
      contents: fs.readFileSync(args.path, 'utf8')
        .replace('const length = (horizontal ? box.width : box.height) - 6;', 'const gap = parseFloat(getComputedStyle(branch).getPropertyValue("--preview-gutter") || "6"); const length = (horizontal ? box.width : box.height) - gap;')
        .replace('(offset - 3)', '(offset - gap / 2)'),
      loader: 'js'
    }));
  }
}] }).then(() => console.log('Preview bundle ready.')).catch(error => { console.error(error);process.exitCode=1; });
console.log('Preview built. Product source and installed app unchanged.');
