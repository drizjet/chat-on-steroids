import { isNewer } from '../shared/types.js';

/**
 * Which side of an update the browser extension sits on.
 *
 * One comparison for every surface that needs to say "the extension is behind" or "the app is
 * behind". Counting only the versions keeps the rule testable and gives both renderer paths the
 * same answer.
 */
export function extensionVersionRelation(
  current: string,
  extensionVersion: string | null | undefined
): 'unknown' | 'same' | 'extension-behind' | 'app-behind' {
  if (!extensionVersion) return 'unknown';
  if (isNewer(current, extensionVersion)) return 'extension-behind';
  if (isNewer(extensionVersion, current)) return 'app-behind';
  return 'same';
}
