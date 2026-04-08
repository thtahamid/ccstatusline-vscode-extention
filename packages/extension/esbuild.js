const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Copy media files to out/media
function copyMedia() {
  const srcDir = path.join(__dirname, 'src', 'media');
  const outDir = path.join(__dirname, 'out', 'media');
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
  }
}

// Copy xterm.js and addon-fit from node_modules
function copyXtermAssets() {
  const outDir = path.join(__dirname, 'out', 'media');
  fs.mkdirSync(outDir, { recursive: true });

  // Find xterm in parent node_modules (hoisted by workspaces) or local
  const locations = [
    path.join(__dirname, 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules')
  ];

  for (const base of locations) {
    const xtermJs = path.join(base, '@xterm', 'xterm', 'lib', 'xterm.js');
    const xtermCss = path.join(base, '@xterm', 'xterm', 'css', 'xterm.css');
    const fitJs = path.join(base, '@xterm', 'addon-fit', 'lib', 'addon-fit.js');

    if (fs.existsSync(xtermJs)) {
      fs.copyFileSync(xtermJs, path.join(outDir, 'xterm.js'));
      fs.copyFileSync(xtermCss, path.join(outDir, 'xterm.css'));
      if (fs.existsSync(fitJs)) {
        fs.copyFileSync(fitJs, path.join(outDir, 'addon-fit.js'));
      }
      return;
    }
  }

  console.warn('Warning: Could not find @xterm/xterm in node_modules');
}

async function build() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    mainFields: ['module', 'main'],
    alias: {
      '@ccstatusline/core': path.resolve(__dirname, '..', 'core', 'src', 'index.ts')
    },
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx'
    },
    tsconfig: path.join(__dirname, 'tsconfig.json'),
    logLevel: 'info',
    plugins: [{
      name: 'copy-media',
      setup(build) {
        build.onEnd(() => {
          copyMedia();
          copyXtermAssets();
        });
      }
    }]
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
