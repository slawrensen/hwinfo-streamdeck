// What Windows itself says about a file's Authenticode signature: the trust
// half that scripts/lib/authenticode.mjs (bytes only) cannot answer.
// signtool's default Authenticode policy (`verify /pa`) and PowerShell's
// Get-AuthenticodeSignature both build the chain to a trusted root and
// check the timestamp; the release requires both to agree. Windows only;
// every function reports UNAVAILABLE elsewhere instead of guessing.
// Paths reach PowerShell through an environment variable and an encoded
// command, never through script text.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const onWindows = process.platform === "win32";

/** The Windows PowerShell 5.1 executable every supported Windows has. */
function powershellExe() {
	return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** This process's environment plus `env`, without PSModulePath. Started
 * from PowerShell 7 (a GitHub Actions run step, a pwsh prompt), Windows
 * PowerShell inherits PowerShell 7's module folders first and cannot load
 * Microsoft.PowerShell.Security, so Get-AuthenticodeSignature fails. With
 * no PSModulePath, Windows PowerShell builds its own. */
export function windowsPowershellEnv(env = {}) {
	const out = { ...process.env, ...env };
	for (const name of Object.keys(out)) if (name.toUpperCase() === "PSMODULEPATH") delete out[name];
	return out;
}

/** Runs a PowerShell script with the given environment; returns parsed JSON
 * from its stdout, or throws one sentence. */
function powershellJson(script, env) {
	const prelude = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ";
	const encoded = Buffer.from(prelude + script, "utf16le").toString("base64");
	const result = spawnSync(powershellExe(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { encoding: "utf8", env: windowsPowershellEnv(env), timeout: 120000, windowsHide: true });
	if (result.error) throw new Error(`PowerShell could not start: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`PowerShell exited with ${result.status}: ${(result.stderr || result.stdout).trim().split(/\r?\n/).slice(0, 3).join(" ")}`);
	try {
		return JSON.parse(result.stdout.trim());
	} catch {
		throw new Error(`PowerShell printed no JSON: ${result.stdout.trim().slice(0, 200)}`);
	}
}

const CERTIFICATE_JSON = "function cert($c) { if ($null -eq $c) { return $null }; [ordered]@{ subject = $c.Subject; issuer = $c.Issuer; thumbprint = $c.Thumbprint; serialNumber = $c.SerialNumber; notBefore = $c.NotBefore.ToUniversalTime().ToString('o'); notAfter = $c.NotAfter.ToUniversalTime().ToString('o') } }; ";

/**
 * Get-AuthenticodeSignature for one file: { status, statusMessage,
 * signatureType, signer, timestamper } with the two certificates as
 * { subject, issuer, thumbprint, serialNumber, notBefore, notAfter } or
 * null. Throws off Windows or when PowerShell fails.
 */
export function authenticodeSignature(file) {
	if (!onWindows) throw new Error("UNAVAILABLE: Get-AuthenticodeSignature runs on Windows only");
	return powershellJson(`${CERTIFICATE_JSON}$s = Get-AuthenticodeSignature -LiteralPath $env:AUTHENTICODE_TARGET; [ordered]@{ status = [string]$s.Status; statusMessage = [string]$s.StatusMessage; signatureType = [string]$s.SignatureType; signer = (cert $s.SignerCertificate); timestamper = (cert $s.TimeStamperCertificate) } | ConvertTo-Json -Compress -Depth 4`, { AUTHENTICODE_TARGET: path.resolve(file) });
}

/** A file's version resource FileVersion, or null. */
export function fileVersion(file) {
	if (!onWindows) return null;
	try {
		return powershellJson("[ordered]@{ v = (Get-Item -LiteralPath $env:AUTHENTICODE_TARGET).VersionInfo.FileVersion } | ConvertTo-Json -Compress", { AUTHENTICODE_TARGET: path.resolve(file) }).v ?? null;
	} catch {
		return null;
	}
}

/** The newest Windows SDK x64 signtool.exe: { path, sdk } or null. */
export function findSigntool() {
	if (!onWindows) return null;
	const kits = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
	if (!fs.existsSync(kits)) return null;
	const versions = fs.readdirSync(kits).filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name) && fs.existsSync(path.join(kits, name, "x64", "signtool.exe")));
	versions.sort((a, b) => {
		const pa = a.split(".").map(Number);
		const pb = b.split(".").map(Number);
		for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
		return 0;
	});
	const sdk = versions.at(-1);
	return sdk === undefined ? null : { path: path.join(kits, sdk, "x64", "signtool.exe"), sdk };
}

/**
 * `signtool verify /pa /all /v <file>`: { ok, timestamp, output } where ok
 * is signtool's own verdict (exit 0 and "Successfully verified") and
 * timestamp is the time signtool reports for the signature's timestamp, or
 * null when it reports none.
 */
export function signtoolVerify(file, signtool) {
	const result = spawnSync(signtool, ["verify", "/pa", "/all", "/v", path.resolve(file)], { encoding: "utf8", timeout: 120000, windowsHide: true });
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`;
	return parseSigntoolVerify(output, result.status);
}

/** The verdict and timestamp from signtool verify's verbose output. */
export function parseSigntoolVerify(output, status) {
	const timestamp = /The signature is timestamped:\s*(.+?)\s*$/m.exec(output)?.[1] ?? null;
	const ok = status === 0 && /Successfully verified:/.test(output) && !/Number of errors:\s*[1-9]/.test(output);
	return { ok, timestamp, output };
}
