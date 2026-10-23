let onlinePresentation = false;
export function selectRunMode(mode: 'online' | 'practice'): void { onlinePresentation = mode === 'online'; }
export function isOnlineRunMode(): boolean { return onlinePresentation; }
export function assertPracticeRun(): void { if (onlinePresentation) throw new Error('Online runs accept confirmed server actions only.'); }
