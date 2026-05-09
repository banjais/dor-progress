import fs from 'node:fs';
import path from 'node:path';

const BUILD_DIR = '.build';
const FORBIDDEN_EXTENSIONS = ['.yml', '.yaml', '.sh', '.map'];

function getFiles(dir: string): string[] {
    const subdirs = fs.readdirSync(dir);
    const files = subdirs.map((subdir) => {
        const res = path.resolve(dir, subdir);
        return fs.statSync(res).isDirectory() ? getFiles(res) : res;
    });
    return files.flat();
}

console.log(`🔍 Verifying build output in ${BUILD_DIR}...`);

if (!fs.existsSync(BUILD_DIR)) {
    console.error(`❌ Build directory ${BUILD_DIR} does not exist.`);
    process.exit(1);
}

const allFiles = getFiles(BUILD_DIR);
const forbiddenFiles = allFiles.filter((file) =>
    FORBIDDEN_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext))
);

if (forbiddenFiles.length > 0) {
    console.error('❌ Build Verification Failed!');
    console.error(`Found ${forbiddenFiles.length} forbidden files in the build output:`);
    forbiddenFiles.forEach(file => console.error(`  - ${path.relative(process.cwd(), file)}`));
    process.exit(1);
}

console.log('✅ Build verification passed. No forbidden files found.');