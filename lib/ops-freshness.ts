import { todayKst } from './dates';
export function opsActionsBlocked(input: {
  today?: string; detailsLoaded?: boolean; unavailable?: string[];
  refreshing: boolean; loadError: boolean;
}, now = new Date()): boolean {
  return input.refreshing || input.loadError || !input.detailsLoaded || input.today !== todayKst(now)
    || !!input.unavailable?.some(section => ['cleaning', 'checkout', 'cleaners', 'messages'].includes(section));
}
