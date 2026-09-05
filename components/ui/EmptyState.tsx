import type { LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title, description, action, className = '' }: {
  icon?: LucideIcon; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white border border-stone-200 px-6 py-12 flex flex-col items-center text-center ${className}`}>
      {Icon && <Icon size={30} strokeWidth={1.5} className="text-stone-300 mb-4" />}
      <p className="t-body text-stone-700">{title}</p>
      {description && <p className="t-caption text-stone-400 mt-1.5 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
