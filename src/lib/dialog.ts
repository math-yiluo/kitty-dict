/**
 * Themed replacement for native `alert` / `confirm` / `prompt`.
 *
 * Usage:
 *   await alertDialog({ body: 'Saved!' });
 *   const ok = await confirmDialog({ title: '...', body: '...', destructive: true });
 *   const name = await promptDialog({ title: '改名', defaultValue: '舊名' });
 *
 * A single global store drives `<Dialog />` in the root layout, so calls work
 * from anywhere in the app.
 */

import { writable } from 'svelte/store';

export type DialogKind = 'alert' | 'confirm' | 'prompt';

export interface DialogState {
  kind: DialogKind;
  title?: string;
  body?: string;
  defaultValue?: string;
  /** Optional maxlength for prompt input (counted by `<input maxlength>`, i.e. UTF-16 units). */
  maxLength?: number;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  resolve: (value: unknown) => void;
}

export const dialogState = writable<DialogState | null>(null);

export function alertDialog(opts: {
  title?: string;
  body: string;
  confirmText?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    dialogState.set({
      kind: 'alert',
      title: opts.title,
      body: opts.body,
      confirmText: opts.confirmText,
      resolve: () => resolve()
    });
  });
}

export function confirmDialog(opts: {
  title?: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    dialogState.set({
      kind: 'confirm',
      title: opts.title,
      body: opts.body,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      destructive: opts.destructive,
      resolve: (v) => resolve(Boolean(v))
    });
  });
}

export function promptDialog(opts: {
  title?: string;
  body?: string;
  defaultValue?: string;
  maxLength?: number;
  confirmText?: string;
  cancelText?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    dialogState.set({
      kind: 'prompt',
      title: opts.title,
      body: opts.body,
      defaultValue: opts.defaultValue,
      maxLength: opts.maxLength,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      resolve: (v) => resolve(typeof v === 'string' ? v : null)
    });
  });
}
