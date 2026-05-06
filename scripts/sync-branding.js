import fs from 'fs';
import path from 'path';

const pkgPath = path.resolve(process.cwd(), 'package.json');
const brandingPath = path.resolve(process.cwd(), 'src/branding.json');
const versionFilePath = path.resolve(process.cwd(), 'VERSION');
const wranglerPath = path.resolve(process.cwd(), 'wrangler.toml');

if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // 1. Sync branding.json
    if (fs.existsSync(brandingPath)) {
        const currentContent = fs.readFileSync(brandingPath, 'utf8');
        const branding = JSON.parse(currentContent);
        branding.version = pkg.version;
        const newContent = JSON.stringify(branding, null, 2) + '\n';
        if (newContent !== currentContent) {
            fs.writeFileSync(brandingPath, newContent);
            console.log(`✅ Automated: Synced branding.json to v${pkg.version}`);
        }
    }

    // 2. Sync wrangler.toml (if version field exists)
    if (fs.existsSync(wranglerPath)) {
        const originalContent = fs.readFileSync(wranglerPath, 'utf8');
        const versionRegex = /^version\s*=\s*["'].*["']/m;
        if (versionRegex.test(originalContent)) {
            const content = originalContent.replace(versionRegex, `version = "${pkg.version}"`);
            if (content !== originalContent) {
                fs.writeFileSync(wranglerPath, content);
                console.log(`✅ Automated: Synced wrangler.toml to v${pkg.version}`);
            }
        }
    }

    // 3. Sync VERSION file
    const newVersionContent = pkg.version.trim() + '\n';
    const currentVersionContent = fs.existsSync(versionFilePath)
        ? fs.readFileSync(versionFilePath, 'utf8')
        : '';

    if (currentVersionContent !== newVersionContent) {
        fs.writeFileSync(versionFilePath, newVersionContent);
        console.log(`✅ Automated: Synced VERSION file to v${pkg.version}`);
    }


} else {
    console.warn('⚠️ Synchronization skipped: package.json not found.');
}