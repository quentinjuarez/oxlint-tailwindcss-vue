import { describe, expect, it } from 'vitest';

import { bumpVersion, patchPackageJson } from '../scripts/bump-version.mjs';
import { decideBump, strategyForMessage } from '../scripts/decide-bump.mjs';

describe('decide-bump', () => {
  it.each([
    ['feat: add the --fix flag', 'minor'],
    ['feat(cli): add the --fix flag', 'minor'],
    ['fix: keep line numbers after a CRLF value', 'patch'],
    ['perf: reuse one oxlint run per config', 'patch'],
    ['feat!: drop Node 22', 'major'],
    ['fix(cli)!: rename the --format flag', 'major'],
    ['chore: bump vitest', 'none'],
    ['docs: explain the exit codes', 'none'],
    ['release: v0.2.0', 'none'],
  ])('maps "%s" to %s', (message, strategy) => {
    expect(strategyForMessage(message)).toBe(strategy);
  });

  it('treats a BREAKING CHANGE footer as major', () => {
    expect(
      strategyForMessage(
        'fix: rename a flag\n\nBREAKING CHANGE: --out is gone',
      ),
    ).toBe('major');
  });

  it('keeps the most significant strategy of a push', () => {
    expect(decideBump(['docs: x', 'fix: y', 'feat: z', 'chore: w'])).toBe(
      'minor',
    );
    expect(decideBump(['docs: x', 'test: y'])).toBe('none');
  });

  it('lets a forced strategy win', () => {
    expect(decideBump(['feat: z'], 'current')).toBe('current');
    expect(decideBump(['feat: z'], 'none')).toBe('minor');
  });
});

describe('bump-version', () => {
  it.each([
    ['0.1.0', 'patch', '0.1.1'],
    ['0.1.9', 'minor', '0.2.0'],
    ['1.4.2', 'major', '2.0.0'],
  ])('bumps %s with %s to %s', (current, strategy, next) => {
    expect(bumpVersion(current, strategy)).toBe(next);
  });

  it('refuses an unknown strategy and a non-semver version', () => {
    expect(() => bumpVersion('0.1.0', 'current')).toThrow(/Unknown strategy/);
    expect(() => bumpVersion('0.1.0-rc.1', 'patch')).toThrow(/non-semver/);
  });

  it('changes only the version value in package.json', () => {
    const raw =
      '{\n  "name": "x",\n  "version": "0.1.0",\n  "type": "module"\n}\n';
    expect(patchPackageJson(raw, 'minor')).toEqual({
      next: '0.2.0',
      raw: '{\n  "name": "x",\n  "version": "0.2.0",\n  "type": "module"\n}\n',
    });
  });
});
