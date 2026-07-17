import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenPaths = [/^src\/image(?:\.|\/)/, /^dist\/image(?:\.|\/)/];
const forbiddenText = [
	"__imageInternals",
	"TuiImage",
	"PRETTY_IMAGE_PROTOCOL",
	"execFileSync",
	"allow-passthrough",
	"tmuxWrap",
	"\\x1bPtmux;",
	"\\x1b_G",
	"\\x1b]1337;File=",
];

function filesUnder(directory) {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));
}

function inspectTree(directory, label) {
	const files = filesUnder(directory);
	for (const file of files) {
		const path = relative(directory, file).replaceAll("\\", "/");
		const packagePath = `${label}/${path}`;
		if (forbiddenPaths.some((pattern) => pattern.test(packagePath))) {
			throw new Error(`forbidden package path remains: ${packagePath}`);
		}
		if (!/\.(?:[cm]?[jt]s|map)$/.test(path)) continue;
		const text = readFileSync(file, "utf8");
		for (const token of forbiddenText) {
			if (text.includes(token)) throw new Error(`forbidden image surface ${JSON.stringify(token)} remains in ${packagePath}`);
		}
	}
}

function requireHostGenericRead(file) {
	const text = readFileSync(file, "utf8");
	if (!text.includes('readImage') || !text.includes('setText("")')) {
		throw new Error(`host-generic empty read presentation missing from ${relative(root, file)}`);
	}
}

let packDirectory;
try {
	inspectTree(join(root, "src"), "src");
	requireHostGenericRead(join(root, "src/tools/read.ts"));
	if (process.argv.includes("--source-only")) {
		console.log(JSON.stringify({ ok: true, scope: "source" }));
		process.exit(0);
	}
	for (const required of ["dist/index.js", "dist/index.d.ts", "dist/tools/read.js", "dist/tools/read.d.ts"]) {
		readFileSync(join(root, required));
	}
	inspectTree(join(root, "dist"), "dist");
	requireHostGenericRead(join(root, "dist/tools/read.js"));

	packDirectory = mkdtempSync(join(tmpdir(), "pi-pretty-pack-"));
	const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], {
		cwd: root,
		encoding: "utf8",
	});
	if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr.trim()}`);
	const [metadata] = JSON.parse(packed.stdout);
	const paths = metadata.files.map((file) => file.path.replaceAll("\\", "/"));
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	for (const required of [manifest.main, "dist/index.d.ts", "dist/tools/read.js", "dist/tools/read.d.ts", "src/index.ts", "src/tools/read.ts"]) {
		if (!paths.includes(required)) throw new Error(`packed artifact missing required path: ${required}`);
	}
	for (const path of paths) {
		if (forbiddenPaths.some((pattern) => pattern.test(path))) throw new Error(`packed artifact contains forbidden path: ${path}`);
	}
	console.log(JSON.stringify({ ok: true, filename: metadata.filename, files: paths.length, main: manifest.main }));
} catch (error) {
	console.error(`packed image ownership verification failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	if (packDirectory) rmSync(packDirectory, { recursive: true, force: true });
}
