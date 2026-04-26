'use client';

import { ChevronRight, Trash2 } from 'lucide-react';
import type { GlobalSupplyTodo } from '../types';

interface SupplyTodoListProps {
  allSupplyTodos: GlobalSupplyTodo[];
  onToggle: (todoId: string, done: boolean, updateLocal?: boolean) => void;
  onDelete: (todoId: string, updateLocal?: boolean) => void;
}

export function SupplyTodoList({ allSupplyTodos, onToggle, onDelete }: SupplyTodoListProps) {
  const pending = allSupplyTodos.filter(t => !t.done);
  const done = allSupplyTodos.filter(t => t.done);
  if (pending.length === 0 && done.length === 0) return null;

  const grouped = new Map<string, typeof pending>();
  pending.forEach(t => {
    const list = grouped.get(t.propertyName) || [];
    list.push(t);
    grouped.set(t.propertyName, list);
  });

  return (
    <div className="bg-white border border-stone-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">필요 비품</h3>
        <span className="text-xs text-stone-500 tabular-nums">{pending.length}개 미완료</span>
      </div>

      {pending.length > 0 && (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([propName, items]) => (
            <div key={propName} className="space-y-1.5">
              <p className="text-xs text-stone-500 font-medium">{propName}</p>
              {items.map(todo => (
                <div key={todo.id} className="flex items-center gap-3 group py-1">
                  <button
                    onClick={() => onToggle(todo.id, true, false)}
                    className="w-4 h-4 border border-stone-300 hover:border-[var(--brand)] flex items-center justify-center shrink-0 transition-colors"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-stone-800">{todo.text}</p>
                    <p className="text-[11px] text-stone-400 mt-0.5">{todo.date}</p>
                  </div>
                  <button
                    onClick={() => onDelete(todo.id, false)}
                    className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 transition-all shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <details className="group">
          <summary className="text-xs text-stone-400 cursor-pointer hover:text-stone-600 transition-colors list-none flex items-center gap-1.5">
            <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
            완료 ({done.length})
          </summary>
          <div className="mt-2 space-y-1">
            {done.map(todo => (
              <div key={todo.id} className="flex items-center gap-3 group py-1">
                <button
                  onClick={() => onToggle(todo.id, false, false)}
                  className="w-4 h-4 bg-[var(--brand-tint)] border border-[var(--brand)]/40 flex items-center justify-center shrink-0 transition-colors"
                >
                  <span className="text-[var(--brand-dark)] text-[10px]">✓</span>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-stone-400 line-through">{todo.text}</p>
                  <p className="text-[11px] text-stone-300 mt-0.5">{todo.propertyName} · {todo.date}</p>
                </div>
                <button
                  onClick={() => onDelete(todo.id, false)}
                  className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 transition-all shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
