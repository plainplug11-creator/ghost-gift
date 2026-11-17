import { t } from '../core/i18n';
import { ApiError } from './types';

/** User-facing text for any API failure (never throws). */
export function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'NO_BALANCE') return t('case.noBalance');
    if (e.code === 'OFFLINE') return t('err.offline');
    if (e.code === 'AUTH') return t('err.auth');
    if (e.code === 'NFT_PENDING') return t('err.nftPending');
    if (e.code === 'CANCELLED') return t('err.cancelled');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return t('err.offline');
  return t('err.generic');
}
