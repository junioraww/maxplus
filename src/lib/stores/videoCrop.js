import { writable } from 'svelte/store';

export const videoCropState = writable({
  isOpen: false,
  sourcePath: '',
  previewUrl: '',
  onConfirm: null,
  onCancel: null,
});

export function openVideoCropModal(options) {
  videoCropState.set({
    isOpen: true,
    sourcePath: options.sourcePath || '',
    previewUrl: options.previewUrl || '',
    onConfirm: options.onConfirm || null,
    onCancel: options.onCancel || null,
  });
}

export function closeVideoCropModal() {
  videoCropState.set({
    isOpen: false,
    sourcePath: '',
    previewUrl: '',
    onConfirm: null,
    onCancel: null,
  });
}
