import type { ErrorCodes } from '@vue/compiler-core';
import { parse, parseCache, type SFCParseResult } from '@vue/compiler-sfc';

const DUPLICATE_ATTRIBUTE = 2 as ErrorCodes.DUPLICATE_ATTRIBUTE;
const MISSING_DIRECTIVE_NAME = 26 as ErrorCodes.X_MISSING_DIRECTIVE_NAME;
const PROBE = `x"' v- v-/><x v-/>`;
const IN_TAG = PROBE.indexOf('v-');
const REPEATED = PROBE.indexOf('v-', IN_TAG + 1);
const NEXT_TAG = PROBE.lastIndexOf('v-');

// compiler-core keeps its v-pre state when a parse ends inside the opening tag
// that carries v-pre: every later parse in the process then reads directives
// as attributes. The probe ends any opening tag the source ends in, so its own
// parse closes that tag; Vue reports a nameless `v-` only outside v-pre and a
// repeated attribute only inside a tag.
export function endsInsideVPreTag(source: string): boolean {
  if (!source.includes('v-pre')) return false;
  const errors = probeErrors(source + PROBE);
  const reported = (code: number, index: number): boolean =>
    errors.some(
      (error) =>
        'code' in error &&
        error.code === code &&
        error.loc?.start.offset === source.length + index,
    );
  return (
    reported(DUPLICATE_ATTRIBUTE, REPEATED) &&
    !reported(MISSING_DIRECTIVE_NAME, IN_TAG) &&
    reported(MISSING_DIRECTIVE_NAME, NEXT_TAG)
  );
}

function probeErrors(probe: string): SFCParseResult['errors'] {
  try {
    return parse(probe, { filename: 'component.vue', sourceMap: false }).errors;
  } catch {
    // compiler-core only throws outside v-pre (a nameless directive with a
    // modifier), so no v-pre state is pending.
    return [];
  } finally {
    parseCache.clear();
  }
}
