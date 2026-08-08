/**
 * Pure orb binary resolution — no LSP `connection` dependency, so it's
 * directly unit-testable. server.ts wires this up with the real
 * process.env / require.resolve / logger and owns the result cache.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export const BINARY_NAME = process.platform === 'win32' ? 'orb.exe' : 'orb';

// The published, actively-maintained CLI is @almadar/orb (bin: "orb") — NOT
// @almadar/cli (bin: "almadar"), which is a stale, unmaintained package that
// predates .lolo support.
const PLATFORM_PACKAGE: Record<string, string> = {
    'darwin-x64': '@almadar/orb-darwin-x64',
    'darwin-arm64': '@almadar/orb-darwin-arm64',
    'linux-x64': '@almadar/orb-linux-x64',
    'linux-arm64': '@almadar/orb-linux-arm64',
    'win32-x64': '@almadar/orb-windows-x64',
};

export interface OrbBinaryLogger {
    warn(message: string): void;
}

export interface ResolveOrbBinaryOptions {
    /** Absolute path override — ORB_BIN env var, or initializationOptions.orbBin as fallback. */
    orbBinOverride?: string | null;
    workspaceRoot?: string | null;
    /** Extra node_modules-walk search roots (e.g. process.cwd(), the bundle's own dir). */
    extraSearchRoots?: string[];
    logger?: OrbBinaryLogger;
    /** Injection point for `require.resolve` (only available post-bundle via tsup's banner). */
    requireResolve?: (id: string) => string;
    /** Injection point for os.homedir (defaults to the real one) — lets tests control it directly. */
    homedir?: () => string;
}

export interface ResolvedOrbBinary {
    path: string;
    strategy: string;
}

function isExecutableFile(candidate: string): boolean {
    try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function resolveOverride(override: string | null | undefined, logger: OrbBinaryLogger): string | null {
    if (!override) return null;
    if (isExecutableFile(override)) return override;

    logger.warn(
        `OrbLSP: ORB_BIN/orbBin was set to "${override}" but it does not exist or is not executable — ignoring and continuing binary resolution.`
    );
    return null;
}

function resolveFromPath(): string | null {
    try {
        execFileSync('orb', ['--version'], { timeout: 5000, stdio: 'ignore' });
        return 'orb';
    } catch {
        return null;
    }
}

/** Not applicable on win32 — mirrors the nvim client's config-then-PATH convention. */
function resolveFromWellKnownDirs(homedir: () => string): string | null {
    if (process.platform === 'win32') return null;

    const home = homedir();
    const candidates = [
        path.join(home, 'bin', BINARY_NAME),
        path.join(home, '.local', 'bin', BINARY_NAME),
        path.join('/usr/local/bin', BINARY_NAME),
    ];
    for (const candidate of candidates) {
        if (isExecutableFile(candidate)) return candidate;
    }
    return null;
}

function resolveFromNpmPackage(
    workspaceRoot: string | null | undefined,
    extraSearchRoots: string[],
    requireResolve: ((id: string) => string) | undefined,
): string | null {
    const packageName = PLATFORM_PACKAGE[`${process.platform}-${process.arch}`];
    if (!packageName) return null;

    if (requireResolve) {
        try {
            const pkgJson = requireResolve(`${packageName}/package.json`);
            const binaryPath = path.join(path.dirname(pkgJson), BINARY_NAME);
            if (fs.existsSync(binaryPath)) return binaryPath;
        } catch { /* not found via require */ }
    }

    const searchRoots = [workspaceRoot, ...extraSearchRoots].filter((r): r is string => Boolean(r));
    for (const root of searchRoots) {
        let dir = root;
        for (let i = 0; i < 6; i++) {
            const candidate = path.join(dir, 'node_modules', packageName, BINARY_NAME);
            if (fs.existsSync(candidate)) return candidate;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return null;
}

/**
 * Resolution order:
 *   1. ORB_BIN env var / initializationOptions.orbBin — wins outright if executable.
 *   2. `orb` on PATH.
 *   3. Well-known local install dirs (~/bin, ~/.local/bin, /usr/local/bin).
 *   4. Published @almadar/orb-<platform> npm package (require.resolve, then a node_modules walk).
 */
export function resolveOrbBinary(options: ResolveOrbBinaryOptions = {}): ResolvedOrbBinary | null {
    const logger = options.logger ?? { warn: () => { /* no-op */ } };

    const override = resolveOverride(options.orbBinOverride, logger);
    if (override) return { path: override, strategy: 'ORB_BIN/orbBin override' };

    const onPath = resolveFromPath();
    if (onPath) return { path: onPath, strategy: 'PATH' };

    const wellKnown = resolveFromWellKnownDirs(options.homedir ?? os.homedir);
    if (wellKnown) return { path: wellKnown, strategy: 'well-known local dir' };

    const npmPackage = resolveFromNpmPackage(options.workspaceRoot, options.extraSearchRoots ?? [], options.requireResolve);
    if (npmPackage) return { path: npmPackage, strategy: 'npm platform package' };

    return null;
}
