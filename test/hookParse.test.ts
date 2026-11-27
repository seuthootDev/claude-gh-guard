import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseCommand } from "../src/hook/parse.ts";

const R = path.resolve("/r");

test("plain commit", () => assert.deepEqual(parseCommand('git commit -m "a && b"', R), [{ kind: "commit", cwd: R }]));
test("chained add+commit+push upstream", () => {
  assert.deepEqual(parseCommand("git add . && git commit -m x && git push upstream main", R).map(g => [g.kind, g.remoteName]), [["commit", undefined], ["push", "upstream"]]);
});
test("cd then git -C", () => {
  assert.equal(parseCommand("cd sub && git -C ../other push", R)[0].cwd, path.resolve(R, "sub", "../other"));
});
test("cd with quoted path containing spaces", () => {
  assert.equal(parseCommand('cd "my dir" && git commit -m x', R)[0].cwd, path.resolve(R, "my dir"));
  assert.equal(parseCommand("cd 'my dir'; git push", R)[0].cwd, path.resolve(R, "my dir"));
});
test("cd with no arg or '-' leaves cwd", () => {
  assert.equal(parseCommand("cd && git commit -m x", R)[0].cwd, R);
  assert.equal(parseCommand("cd - && git commit -m x", R)[0].cwd, R);
});
test("inline email overrides", () => {
  assert.equal(parseCommand("git -c user.email=me@p.com commit -m x", R)[0].emailOverride, "me@p.com");
  assert.equal(parseCommand("GIT_AUTHOR_EMAIL=me@p.com git commit -m x", R)[0].emailOverride, "me@p.com");
  assert.equal(parseCommand("git -c core.editor=vim commit -m x", R)[0].emailOverride, undefined);
});
test("commit --author sets the effective author email", () => {
  assert.equal(parseCommand('git commit --author="A <a@x.com>" -m x', R)[0].emailOverride, "a@x.com");
  assert.equal(parseCommand('git commit --author "A <a@x.com>"', R)[0].emailOverride, "a@x.com");
  assert.equal(parseCommand('GIT_AUTHOR_EMAIL=b@x.com git commit --author="A <a@x.com>"', R)[0].emailOverride, "a@x.com");
  assert.equal(parseCommand('git -c user.email=c@x.com commit --author="A <a@x.com>"', R)[0].emailOverride, "a@x.com");
  assert.equal(parseCommand("git commit --author=someone -m x", R)[0].emailOverride, undefined);
  assert.equal(parseCommand('git commit -m x -- --author="A <a@x.com>"', R)[0].emailOverride, undefined);
});
test("gh pr create --repo / -R / =", () => {
  assert.equal(parseCommand("gh pr create -R corp/app --fill", R)[0].ghRepo, "corp/app");
  assert.equal(parseCommand("gh pr create --repo corp/app", R)[0].ghRepo, "corp/app");
  assert.equal(parseCommand("gh pr create --repo=corp/app", R)[0].ghRepo, "corp/app");
  assert.equal(parseCommand("gh pr create", R)[0].kind, "pr");
});
test("other gh commands ignored", () => assert.deepEqual(parseCommand("gh pr list && gh issue create", R), []));
test("push to raw URL / scp / https", () => {
  assert.equal(parseCommand("git push git@github.com:o/r.git", R)[0].remoteUrl, "git@github.com:o/r.git");
  assert.equal(parseCommand("git push https://github.com/o/r.git main", R)[0].remoteUrl, "https://github.com/o/r.git");
  assert.equal(parseCommand("git push github.com:o/r.git", R)[0].remoteUrl, "github.com:o/r.git");
  assert.equal(parseCommand("git push origin HEAD:main", R)[0].remoteName, "origin");
});
test("push options consume values", () => {
  const g = parseCommand("git push -o ci.skip -u origin main", R)[0];
  assert.equal(g.remoteName, "origin");
  assert.equal(parseCommand("git push --push-option x --force upstream", R)[0].remoteName, "upstream");
  assert.equal(parseCommand("git push -u", R)[0].remoteName, undefined);
});
test("git global flag-only options skipped", () => {
  assert.equal(parseCommand("git --no-pager -P commit -m x", R).length, 1);
  assert.equal(parseCommand("git --bare push origin", R)[0].remoteName, "origin");
});
test("--git-dir / --work-tree skip segment", () => {
  assert.deepEqual(parseCommand("git --git-dir=/x/.git commit -m x", R), []);
  assert.deepEqual(parseCommand("git --work-tree=/x push", R), []);
});
test("non-guarded commands → []", () => {
  assert.deepEqual(parseCommand("git status; echo 'git push'", R), []);
  assert.deepEqual(parseCommand("echo git push", R), []);
  assert.deepEqual(parseCommand('"git push"', R), []);
  assert.deepEqual(parseCommand("git log", R), []);
  assert.deepEqual(parseCommand("git commit-graph write", R), []);
});
test("separators: | ; newline ||", () => {
  assert.deepEqual(parseCommand("false || git commit -m x\ngit push; echo a | git push", R).map(g => g.kind), ["commit", "push", "push"]);
});
test("separators inside quotes ignored; escapes in double quotes", () => {
  assert.deepEqual(parseCommand('git commit -m "say \\"hi\\" && git push"', R).map(g => g.kind), ["commit"]);
  assert.deepEqual(parseCommand("git commit -m 'a; git push'", R).map(g => g.kind), ["commit"]);
});
test("git.exe, gh.exe and absolute paths", () => {
  assert.equal(parseCommand("git.exe commit -m x", R).length, 1);
  assert.equal(parseCommand("GIT.EXE commit -m x", R).length, 1);
  assert.equal(parseCommand('"C:\\Program Files\\Git\\cmd\\git.exe" push origin', R)[0].remoteName, "origin");
  assert.equal(parseCommand("/usr/bin/git commit -m x", R).length, 1);
  assert.equal(parseCommand("gh.exe pr create -R a/b", R)[0].ghRepo, "a/b");
  assert.deepEqual(parseCommand("mygit commit", R), []);
});
test("cd persists across segments, -C relative to it", () => {
  const g = parseCommand("cd a; cd b && git commit -m x", R);
  assert.equal(g[0].cwd, path.resolve(R, "a", "b"));
});
test("empty / unterminated quote don't throw", () => {
  assert.deepEqual(parseCommand("", R), []);
  assert.doesNotThrow(() => parseCommand('git commit -m "abc', R));
});
test("heredoc body is not parsed", () => {
  assert.deepEqual(parseCommand("cat > x.md <<'EOF'\ngit push origin main\nEOF", R), []);
});
test("heredoc with apostrophe then real push", () => {
  const g = parseCommand("cat <<EOF > x\ndon't stop\nEOF\ngit push origin main", R);
  assert.deepEqual(g.map(x => [x.kind, x.remoteName]), [["push", "origin"]]);
});
test("<<- heredoc strips tabs for delimiter", () => {
  assert.deepEqual(parseCommand("cat <<-EOF\n\tgit push\n\tEOF\ngit commit -m x", R).map(g => g.kind), ["commit"]);
});
test("claude-style commit with heredoc message", () => {
  const cmd = "git commit -m \"$(cat <<'EOF'\nmsg line\n\nCo-Authored-By: X\nEOF\n)\"";
  assert.deepEqual(parseCommand(cmd, R).map(g => g.kind), ["commit"]);
});
test("redirections are not the push remote", () => {
  assert.equal(parseCommand("git push 2>&1 | tail -5", R)[0].remoteName, undefined);
  assert.equal(parseCommand("git push >/dev/null", R)[0].remoteName, undefined);
  assert.equal(parseCommand("git push origin main > out.txt", R)[0].remoteName, "origin");
  assert.equal(parseCommand("git push -u origin HEAD 2> err.log", R)[0].remoteName, "origin");
  assert.equal(parseCommand("git push &> all.log origin", R)[0].remoteName, "origin");
});
