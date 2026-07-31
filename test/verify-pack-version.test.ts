/**
 * Pack-floor gate (scripts/verify-pack-version.mjs) against synthetic git
 * repos. The floor must be scoped to tags reachable from HEAD: after v2.0.0
 * is tagged on main, a 1.4.1 pack cut from the release/1.4.x maintenance
 * branch must still pass, while repacking an already-released version from
 * an untagged commit, regressing to an older version, and a 2.x pack that
 * does not clear 2.0.0 all stay refused. Tags are annotated, matching every
 * real tag in this repo. Runs the real script in temp repos; nothing here
 * touches this repo's git state.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REAL_SCRIPT = fileURLToPath(new URL("../scripts/verify-pack-version.mjs", import.meta.url));

/** One synthetic repo: script + manifest scaffold, empty commits, v* tags. */
class ScratchRepo {
	readonly root: string;

	constructor() {
		this.root = mkdtempSync(join(tmpdir(), "vpv-test-"));
		mkdirSync(join(this.root, "scripts"), { recursive: true });
		mkdirSync(join(this.root, "com.lawrensen.hwinfo.sdPlugin"), { recursive: true });
		cpSync(REAL_SCRIPT, join(this.root, "scripts", "verify-pack-version.mjs"));
		this.git("init", "-q", "-b", "main");
	}

	git(...args: string[]): string {
		return execFileSync(
			"git",
			["-c", "user.name=vpv-test", "-c", "user.email=vpv@test.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgSign=false", ...args],
			{ cwd: this.root, encoding: "utf8" }
		).trim();
	}

	commit(message: string): string {
		this.git("commit", "--allow-empty", "-q", "-m", message);
		return this.git("rev-parse", "HEAD");
	}

	/** Annotated tag, like every real release tag in this repo. */
	tag(name: string): void {
		this.git("tag", "-a", "-m", name, name);
	}

	/** Runs the gate with the given manifest Version; returns the exit code. */
	run(version: string): { status: number; stderr: string } {
		writeFileSync(join(this.root, "com.lawrensen.hwinfo.sdPlugin", "manifest.json"), `${JSON.stringify({ Version: version }, null, "\t")}\n`);
		const result = spawnSync(process.execPath, [join(this.root, "scripts", "verify-pack-version.mjs")], { encoding: "utf8" });
		return { status: result.status ?? -1, stderr: result.stderr };
	}

	dispose(): void {
		rmSync(this.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}

describe("verify-pack-version: floor scoped to tags reachable from HEAD", () => {
	let repo: ScratchRepo;
	/** Untagged tip of release/1.4.x; v2.0.0 lives only on main. */
	let maintHead = "";
	/** The commit v2.0.0 points at (on main). */
	let twoZero = "";
	/** Untagged commit on main after v2.0.0. */
	let postTwo = "";

	before(() => {
		repo = new ScratchRepo();
		repo.commit("release 1.3.0");
		repo.tag("v1.3.0");
		repo.commit("release 1.4.0");
		repo.tag("v1.4.0");
		// The real branch model: maintenance continues on release/1.4.x while
		// main moves on to 2.0.
		repo.git("checkout", "-q", "-b", "release/1.4.x");
		maintHead = repo.commit("maintenance work after v1.4.0");
		repo.git("checkout", "-q", "main");
		twoZero = repo.commit("release 2.0.0");
		repo.tag("v2.0.0");
		postTwo = repo.commit("work after v2.0.0");
	});

	after(() => {
		repo.dispose();
	});

	it("passes a 1.4.1 maintenance pack after v2.0.0 exists on main", () => {
		repo.git("checkout", "-q", maintHead);
		const { status, stderr } = repo.run("1.4.1.0");
		assert.equal(status, 0, stderr);
		assert.match(stderr, /clears the newest release on this line \(1\.4\.0\.0\)/);
	});

	it("still refuses repacking the released 1.4.0 from an untagged commit", () => {
		repo.git("checkout", "-q", maintHead);
		const { status, stderr } = repo.run("1.4.0.0");
		assert.equal(status, 1, stderr);
		assert.match(stderr, /does not clear/);
	});

	it("still refuses regressing to 1.3.0", () => {
		repo.git("checkout", "-q", maintHead);
		const { status, stderr } = repo.run("1.3.0.0");
		assert.equal(status, 1, stderr);
		assert.match(stderr, /does not clear/);
	});

	it("still requires a 2.x pack to clear 2.0.0 on the 2.x line", () => {
		repo.git("checkout", "-q", postTwo);
		assert.equal(repo.run("2.0.0.0").status, 1, "2.0.0.0 must not clear the released v2.0.0");
		assert.equal(repo.run("2.0.1.0").status, 0, "2.0.1.0 must clear v2.0.0");
	});

	it("keeps excluding tags that point at HEAD (the release-workflow pack)", () => {
		repo.git("checkout", "-q", twoZero);
		const { status, stderr } = repo.run("2.0.0.0");
		assert.equal(status, 0, stderr);
		assert.match(stderr, /clears the newest release on this line \(1\.4\.0\.0\)/);
	});

	it("floors against every tag, and says so, when HEAD does not resolve", () => {
		// An orphan HEAD (git symbolic-ref to a branch that does not exist)
		// cannot answer --merged; the fallback must be stricter, not weaker.
		repo.git("symbolic-ref", "HEAD", "refs/heads/orphan-does-not-exist");
		try {
			const refused = repo.run("1.4.1.0");
			assert.equal(refused.status, 1, refused.stderr);
			assert.match(refused.stderr, /every tag counted/);
			assert.equal(repo.run("2.0.1.0").status, 0, "clearing every tag still passes");
		} finally {
			repo.git("checkout", "-q", "main");
		}
	});
});

describe("verify-pack-version: degenerate repos stay non-fatal", () => {
	it("warns and passes when no v* tag is reachable", () => {
		const repo = new ScratchRepo();
		try {
			repo.commit("only commit, no tags");
			const { status, stderr } = repo.run("1.0.0.0");
			assert.equal(status, 0, stderr);
			assert.match(stderr, /no v\* tags visible/);
		} finally {
			repo.dispose();
		}
	});

	it("falls back cleanly on an unborn HEAD (git init, no commits)", () => {
		const repo = new ScratchRepo();
		try {
			const { status, stderr } = repo.run("1.0.0.0");
			assert.equal(status, 0, stderr);
			assert.match(stderr, /no v\* tags visible/);
		} finally {
			repo.dispose();
		}
	});
});
