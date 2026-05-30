const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');
const APP_DIR = path.join(BASE_DIR, 'app');

let ZALO_VERSION = null;

async function main() {
  console.log('🚀 Building Zalo for Linux (AppImage, RPM & deb)...');

  try {
    // Read version from package.json.bak
    const packageJsonBakPath = path.join(APP_DIR, 'package.json.bak');
    if (fs.existsSync(packageJsonBakPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonBakPath, 'utf8'));
      ZALO_VERSION = packageJson.version;
      console.log('📝 Read Zalo version from package.json.bak:', ZALO_VERSION);

      // Export global outputs for workflow
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `zalo_version=${ZALO_VERSION}\n`);
      }
    } else {
      console.warn('⚠️  package.json.bak not found, version will be unknown');
    }

    // Phase 1: Build original Zalo
    console.log('\n🔥 PHASE 1: Building Zalo (Original)...\n');

    await build('(Original)', '');

    // Phase 2: Apply ZaDark integration and build final product
    console.log('\n🔥 PHASE 2: Building Zalo (with ZaDark)...\n');

    // Patch ZaDark directly into APP_DIR
    await integrateZaDark();
    await build('(with ZaDark)', '-ZaDark');

    // Final summary
    console.log('\n🎉 ===== BUILD SUMMARY =====');
    const distDir = path.join(BASE_DIR, 'dist');

    if (fs.existsSync(distDir)) {
      const allFiles = fs.readdirSync(distDir)
        .filter(f => f.endsWith('.AppImage') || f.endsWith('.rpm') || f.endsWith('.deb'))
        .sort()
        .map(f => {
          const filePath = path.join(distDir, f);
          const size = fs.statSync(filePath).size;
          const sizeStr = size > 1024 * 1024
            ? `${Math.round(size / 1024 / 1024)}MB`
            : `${Math.round(size / 1024)}KB`;

          const type = f.includes('+ZaDark-') ? '🎨 ZaDark' : '📦 Original';
          return `  ${type} • ${f} (${sizeStr})`;
        })
        .join('\n') || '  (no build files)';
      console.log('\n📁 All built files in dist/:');
      console.log(allFiles);
    }
  } catch (error) {
    console.error('💥 Main workflow failed:', error.message);
    process.exit(1);
  }
}

async function integrateZaDark() {
  // ZaDark Integration (always applied in this project)
  console.log('🎨 Applying ZaDark patches...');

  try {
    // Verify ZaDark module is available
    const zadarkModulePath = path.join(BASE_DIR, 'plugins', 'zadark', 'build', 'pc', 'zadark-pc.js');
    if (!fs.existsSync(zadarkModulePath)) {
      throw new Error('ZaDark PC module not found - run "npm run prepare-zadark" first');
    }

    // Import ZaDark PC module
    console.log('🎯 Applying ZaDark patches to app directory...');

    const zadarkPC = require(zadarkModulePath);
    zadarkPC.copyZaDarkAssets(BASE_DIR);
    zadarkPC.writeIndexFile(BASE_DIR);
    zadarkPC.writeBootstrapFile(BASE_DIR);
    zadarkPC.writePopupViewerFile(BASE_DIR);
    console.log('✅ ZaDark patches applied successfully');

  } catch (error) {
    console.error('❌ ZaDark integration failed:', error.message);
    console.log('💡 Continuing with original app directory...');
  }
}

async function build(buildName = '', outputSuffix = '') {
  try {
    // Get git commit hash for filename
    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

    // Set artifact name and build command based on build type
    let artifactNamePattern;
    let buildCommand;
    let zadarkVersion = null;

    if (outputSuffix === '-ZaDark') {
      // Read ZaDark version for custom naming
      const zadarkPackagePath = path.join(BASE_DIR, 'plugins', 'zadark', 'package.json');
      zadarkVersion = 'unknown';

      if (fs.existsSync(zadarkPackagePath)) {
        try {
          const zadarkPackage = JSON.parse(fs.readFileSync(zadarkPackagePath, 'utf8'));
          zadarkVersion = zadarkPackage.version;
        } catch (error) {
          console.warn('⚠️ Could not read ZaDark version, using "unknown"');
        }
      }

      artifactNamePattern = `Zalo-${ZALO_VERSION}+ZaDark-${zadarkVersion}-${commitHash}.\${ext}`;
      buildCommand = `npx electron-builder --linux AppImage rpm deb --config.linux.artifactName='${artifactNamePattern}' -c.extraMetadata.version=${ZALO_VERSION} --publish=never`;
      console.log(`🔨 Building${buildName ? ` ${buildName}` : ''} with Zalo: ${ZALO_VERSION}, ZaDark: ${zadarkVersion}, Commit: ${commitHash}`);
    } else {
      artifactNamePattern = `Zalo-${ZALO_VERSION}-${commitHash}.\${ext}`;
      buildCommand = `npx electron-builder --linux AppImage rpm deb --config.linux.artifactName='${artifactNamePattern}' -c.extraMetadata.version=${ZALO_VERSION} --publish=never`;
      console.log(`🔨 Building${buildName ? ` ${buildName}` : ''} with Zalo: ${ZALO_VERSION}, Commit: ${commitHash}`);
    }
    
    // Write build-info.json to the app directory so the AppImage/RPM/deb will contain its metadata
    const buildInfo = {
      version: ZALO_VERSION,
      zadarkVersion: outputSuffix === '-ZaDark' ? zadarkVersion : null,
      commit: commitHash,
      buildDate: new Date().toISOString()
    };
    
    const buildInfoPath = path.join(APP_DIR, 'pc-dist', 'build-info.json');
    if (fs.existsSync(path.join(APP_DIR, 'pc-dist'))) {
      fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2), 'utf8');
      console.log(`📝 Wrote build-info.json: ${buildInfoPath}`);
    } else {
      console.warn('⚠️ pc-dist directory not found, skipping build-info.json');
    }

    console.log(`📝 Command: ${buildCommand}`);

    // Capture build output to get file information
    const buildOutput = execSync(buildCommand, {
      stdio: 'pipe',
      cwd: path.join(BASE_DIR),
      encoding: 'utf8'
    });

    console.log(`✅ Completed!`);

    // Debug: Show build output
    console.log('\n🔍 Build Output:');
    console.log(buildOutput);

    // Function to parse and log file details
    const processArtifact = (regexMatch, artifactType) => {
      let file = null;
      let name = null;

      if (regexMatch) {
        file = regexMatch[1];
        name = path.basename(file);
        console.log(`\n📦 ${artifactType}: ${file}`);

        if (fs.existsSync(file)) {
          const fileSize = fs.statSync(file).size;
          console.log(`📏 Size: ${fileSize} bytes`);

          try {
            const sha256Output = execSync(`sha256sum "${file}"`, { encoding: 'utf8' });
            const fileSha256 = sha256Output.split(' ')[0];
            console.log(`🔐 SHA256: ${fileSha256}`);
          } catch (error) {
            console.warn('⚠️ Could not calculate SHA256');
          }
        } else {
          console.warn(`⚠️ ${artifactType} file not found: ${file}`);
        }
      } else {
        console.warn(`⚠️ Could not find ${artifactType} in build output`);
      }
      
      return { file, name };
    };

    // Parse build output for both AppImage and RPM
    const appImageMatch = buildOutput.match(/file=(dist\/[^\s]+\.AppImage)/);
    const rpmMatch = buildOutput.match(/file=(dist\/[^\s]+\.rpm)/);
    const debMatch = buildOutput.match(/file=(dist\/[^\s]+\.deb)/);

    const appImageInfo = processArtifact(appImageMatch, 'AppImage');
    const rpmInfo = processArtifact(rpmMatch, 'RPM');
    const debInfo = processArtifact(debMatch, 'DEB');

    // Export build info to GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      const prefix = outputSuffix === '-ZaDark' ? 'zadark_' : 'original_';

      // Export build-specific info for both file types
      const specificOutputs = [
        `${prefix}appimage_file=${appImageInfo.file || ''}`,
        `${prefix}appimage_name=${appImageInfo.name || ''}`,
        `${prefix}rpm_file=${rpmInfo.file || ''}`,
        `${prefix}rpm_name=${rpmInfo.name || ''}`,
        `${prefix}deb_file=${debInfo.file || ''}`,
        `${prefix}deb_name=${debInfo.name || ''}`
      ];

      specificOutputs.forEach(output => {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
      });

      console.log(`\n📋 Exported ${prefix.replace('_', '')} build info (AppImage, RPM & deb) to GitHub Actions`);
    }
  } catch (error) {
    console.error('💥 Build failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };