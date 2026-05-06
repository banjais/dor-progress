import fs from 'fs';
import path from 'path';

const pkgPath = path.resolve(process.cwd(), 'package.json');
const brandingPath = path.resolve(process.cwd(), 'src/branding.json');

if (fs.existsSync(pkgPath) && fs.existsSync(brandingPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const branding = JSON.parse(fs.readFileSync(brandingPath, 'utf8'));

    branding.version = pkg.version;

    fs.writeFileSync(brandingPath, JSON.stringify(branding, null, 2) + '\n');
    console.log(`✅ Automated: Synced branding.json to v${pkg.version}`);
} else {
    console.warn('⚠️ Synchronization skipped: package.json or src/branding.json not found.');
}